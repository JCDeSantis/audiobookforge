import { app } from 'electron'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync
} from 'fs'
import { unlink } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'

const execAsync = promisify(exec)

export const WHISPER_VERSION = 'v1.8.3'
const CPU_BINARY_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`

// Binary may be named differently across versions
const BINARY_NAMES = ['whisper-cli.exe', 'whisper-main.exe', 'main.exe']

export function getBinDir(): string {
  return join(app.getPath('userData'), 'whisper', 'bin')
}

export function getWhisperExe(): string | null {
  const binDir = getBinDir()
  if (!existsSync(binDir)) return null

  // Scan binDir and two levels deep to find the executable regardless of zip layout
  const candidateDirs: string[] = [binDir]
  try {
    for (const entry of readdirSync(binDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const sub = join(binDir, entry.name)
        candidateDirs.push(sub)
        try {
          for (const sub2 of readdirSync(sub, { withFileTypes: true })) {
            if (sub2.isDirectory()) candidateDirs.push(join(sub, sub2.name))
          }
        } catch {}
      }
    }
  } catch {}

  for (const dir of candidateDirs) {
    for (const name of BINARY_NAMES) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

export function isBinaryDownloaded(): boolean {
  return getWhisperExe() !== null
}

// ── GPU detection ──────────────────────────────────────────────────────────────

export async function detectNvidiaGpu(): Promise<boolean> {
  // nvidia-smi is the most reliable check (present on any system with NVIDIA drivers)
  try {
    await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 5000 })
    return true
  } catch {}
  // Fallback: wmic (always present on Windows, but slower)
  try {
    const { stdout } = await execAsync('wmic path win32_videocontroller get name', {
      timeout: 5000
    })
    return /nvidia/i.test(stdout)
  } catch {}
  return false
}

async function getCudaAssetUrl(): Promise<string | null> {
  try {
    const apiUrl = `https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${WHISPER_VERSION}`
    const response = await axios.get(apiUrl, {
      headers: { 'User-Agent': 'VideoBookForge', Accept: 'application/vnd.github.v3+json' },
      timeout: 10000
    })
    const assets = response.data.assets as Array<{ name: string; browser_download_url: string }>
    // Asset naming: whisper-cublas-{version}-bin-x64.zip (e.g. whisper-cublas-12.4.0-bin-x64.zip)
    const cudaAssets = assets.filter((a) => /whisper-cublas-.*-bin-x64\.zip$/i.test(a.name))
    if (cudaAssets.length === 0) return null
    // Prefer highest CUDA major version (12 > 11)
    cudaAssets.sort((a, b) => {
      const verA = parseFloat(a.name.match(/cublas-(\d+)/)?.[1] ?? '0')
      const verB = parseFloat(b.name.match(/cublas-(\d+)/)?.[1] ?? '0')
      return verB - verA
    })
    return cudaAssets[0].browser_download_url
  } catch {
    return null
  }
}

// ── GPU marker file ────────────────────────────────────────────────────────────

function getGpuMarkerPath(): string {
  return join(getBinDir(), 'gpu.json')
}

export function isGpuEnabled(): boolean {
  const markerPath = getGpuMarkerPath()
  try {
    const data = JSON.parse(readFileSync(markerPath, 'utf8')) as { enabled: boolean }
    return data.enabled === true
  } catch {
    // Binary exists but no marker — it was downloaded before GPU detection was added.
    // Write an explicit CPU marker so the UI can show the correct upgrade notice.
    if (isBinaryDownloaded()) {
      try { writeFileSync(markerPath, JSON.stringify({ enabled: false })) } catch {}
    }
    return false
  }
}

// ── Download helpers ───────────────────────────────────────────────────────────

async function downloadZip(
  url: string,
  destPath: string,
  onProgress: (percent: number, message: string) => void,
  progressStart: number,
  progressEnd: number,
  label: string,
  signal?: AbortSignal
): Promise<void> {
  const response = await axios.get(url, {
    responseType: 'stream',
    maxRedirects: 5,
    headers: { 'User-Agent': 'VideoBookForge' },
    signal
  })

  const total = parseInt(response.headers['content-length'] || '0', 10)
  let downloaded = 0
  const range = progressEnd - progressStart

  await new Promise<void>((resolve, reject) => {
    const writer = createWriteStream(destPath)

    const onAbort = (): void => {
      writer.destroy()
      unlink(destPath).catch(() => {})
      reject(new Error('Cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    response.data.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      if (total > 0) {
        onProgress(progressStart + Math.round((downloaded / total) * range), label)
      }
    })
    response.data.pipe(writer)
    writer.on('finish', () => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        unlink(destPath).catch(() => {})
        reject(new Error('Cancelled'))
      } else {
        resolve()
      }
    })
    writer.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      unlink(destPath).catch(() => {})
      reject(err)
    })
  })
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function deleteBinary(): void {
  const binDir = getBinDir()
  if (existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true })
  }
}

export async function downloadBinary(
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const binDir = getBinDir()
  mkdirSync(binDir, { recursive: true })

  const zipPath = join(binDir, 'whisper-bin.zip')

  // Detect GPU and look up CUDA asset URL in parallel
  onProgress(0, 'Checking system...')
  const [hasGpu, cudaUrl] = await Promise.all([detectNvidiaGpu(), getCudaAssetUrl()])

  if (signal?.aborted) throw new Error('Cancelled')

  const useGpu = hasGpu && cudaUrl !== null
  const downloadUrl = useGpu ? cudaUrl! : CPU_BINARY_URL
  const label = useGpu ? 'Downloading whisper.cpp (GPU)...' : 'Downloading whisper.cpp...'

  onProgress(5, label)
  await downloadZip(downloadUrl, zipPath, onProgress, 5, 80, label, signal)

  if (signal?.aborted) return

  onProgress(82, 'Extracting binary...')
  // Windows 10+ tar.exe supports zip extraction natively
  await execAsync(`tar -xf "${zipPath}" -C "${binDir}"`)
  await unlink(zipPath).catch(() => {})

  // Write GPU marker so transcribe.ts can include it in progress events
  writeFileSync(getGpuMarkerPath(), JSON.stringify({ enabled: useGpu }))

  onProgress(100, useGpu ? 'GPU-accelerated binary ready' : 'Binary ready')
}
