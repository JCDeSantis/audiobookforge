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
const GPU_BINARY_MARKERS = [/ggml-cuda\.dll$/i, /cudart64_.*\.dll$/i, /cublas64_.*\.dll$/i]

// Binary may be named differently across versions
const BINARY_NAMES = ['whisper-cli.exe', 'whisper-main.exe', 'main.exe']

type BinaryMarker = {
  enabled: boolean
  flavor?: 'cpu' | 'gpu'
}

type DownloadBinaryOptions = {
  forceCpu?: boolean
  replaceExisting?: boolean
}

export function getBinDir(): string {
  return join(app.getPath('userData'), 'whisper', 'bin')
}

export function getWhisperExe(): string | null {
  const binDir = getBinDir()
  if (!existsSync(binDir)) return null

  // Scan binDir and two levels deep to find the executable regardless of zip layout.
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
      const binaryPath = join(dir, name)
      if (existsSync(binaryPath)) return binaryPath
    }
  }

  return null
}

export function isBinaryDownloaded(): boolean {
  return getWhisperExe() !== null
}

export async function detectNvidiaGpu(): Promise<boolean> {
  // nvidia-smi is the most reliable check when NVIDIA drivers are installed.
  try {
    await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 5000 })
    return true
  } catch {}

  // Fallback: wmic is slower, but still useful on Windows if nvidia-smi is absent.
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
      headers: { 'User-Agent': 'AudiobookForge', Accept: 'application/vnd.github.v3+json' },
      timeout: 10000
    })
    const assets = response.data.assets as Array<{ name: string; browser_download_url: string }>
    const cudaAssets = assets.filter((asset) =>
      /whisper-cublas-.*-bin-x64\.zip$/i.test(asset.name)
    )

    if (cudaAssets.length === 0) {
      return null
    }

    cudaAssets.sort((left, right) => {
      const leftVersion = parseFloat(left.name.match(/cublas-(\d+)/)?.[1] ?? '0')
      const rightVersion = parseFloat(right.name.match(/cublas-(\d+)/)?.[1] ?? '0')
      return rightVersion - leftVersion
    })

    return cudaAssets[0].browser_download_url
  } catch {
    return null
  }
}

function getGpuMarkerPath(): string {
  return join(getBinDir(), 'gpu.json')
}

function readBinaryMarker(): BinaryMarker | null {
  try {
    return JSON.parse(readFileSync(getGpuMarkerPath(), 'utf8')) as BinaryMarker
  } catch {
    return null
  }
}

function writeBinaryMarker(enabled: boolean, flavor: 'cpu' | 'gpu'): void {
  writeFileSync(getGpuMarkerPath(), JSON.stringify({ enabled, flavor }))
}

function getBinEntriesRecursive(rootDir: string): string[] {
  const entries: string[] = []

  const visit = (dir: string, depth: number): void => {
    if (depth > 3 || !existsSync(dir)) {
      return
    }

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        entries.push(fullPath)
        if (entry.isDirectory()) {
          visit(fullPath, depth + 1)
        }
      }
    } catch {}
  }

  visit(rootDir, 0)
  return entries
}

export function isCudaBinaryDownloaded(): boolean {
  const marker = readBinaryMarker()
  if (marker?.flavor) {
    return marker.flavor === 'gpu'
  }

  const binDir = getBinDir()
  if (!existsSync(binDir)) {
    return false
  }

  return getBinEntriesRecursive(binDir).some((entryPath) =>
    GPU_BINARY_MARKERS.some((pattern) => pattern.test(entryPath))
  )
}

export function isGpuEnabled(): boolean {
  const marker = readBinaryMarker()
  if (marker) {
    return marker.enabled === true
  }

  // Older installs may have a binary but no marker file. Persist the inferred flavor so
  // later runs can distinguish "GPU disabled" from "CPU binary installed."
  if (isBinaryDownloaded()) {
    try {
      writeBinaryMarker(false, isCudaBinaryDownloaded() ? 'gpu' : 'cpu')
    } catch {}
  }

  return false
}

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
    headers: { 'User-Agent': 'AudiobookForge' },
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

    writer.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      unlink(destPath).catch(() => {})
      reject(error)
    })
  })
}

export function deleteBinary(): void {
  const binDir = getBinDir()
  if (existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true })
  }
}

export async function downloadBinary(
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal,
  options: DownloadBinaryOptions = {}
): Promise<void> {
  const { forceCpu = false, replaceExisting = false } = options
  const binDir = getBinDir()

  if (replaceExisting && existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true })
  }

  mkdirSync(binDir, { recursive: true })

  const zipPath = join(binDir, 'whisper-bin.zip')

  onProgress(0, 'Checking system...')
  const [hasGpu, cudaUrl] = forceCpu
    ? [false, null]
    : await Promise.all([detectNvidiaGpu(), getCudaAssetUrl()])

  if (signal?.aborted) throw new Error('Cancelled')

  const useGpu = hasGpu && cudaUrl !== null
  const downloadUrl = useGpu ? cudaUrl : CPU_BINARY_URL
  const label = useGpu ? 'Downloading whisper.cpp (GPU)...' : 'Downloading whisper.cpp...'

  onProgress(5, label)
  await downloadZip(downloadUrl, zipPath, onProgress, 5, 80, label, signal)

  if (signal?.aborted) {
    return
  }

  onProgress(82, 'Extracting binary...')
  await execAsync(`tar -xf "${zipPath}" -C "${binDir}"`)
  await unlink(zipPath).catch(() => {})

  if (!getWhisperExe()) {
    throw new Error('Whisper binary extraction completed, but no executable was found.')
  }

  writeBinaryMarker(useGpu, useGpu ? 'gpu' : 'cpu')
  onProgress(100, useGpu ? 'GPU-accelerated binary ready' : 'Binary ready')
}
