import { app, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'

const EMBEDDED_SERVER_PORT = parseInt(process.env.ABF_PORT ?? '3000', 10) || 3000

let serverProcess: UtilityProcess | null = null

function getServerBundlePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'server', 'index.mjs')
    : join(app.getAppPath(), 'dist', 'server', 'index.mjs')
}

function getWebRootPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'renderer')
    : join(app.getAppPath(), 'out', 'renderer')
}

function getServerDataDir(): string {
  return join(app.getPath('userData'), 'server-data')
}

function getOrCreatePassword(): string {
  const passwordFile = join(app.getPath('userData'), 'server-password.txt')
  if (existsSync(passwordFile)) {
    return readFileSync(passwordFile, 'utf-8').trim()
  }
  const password = randomUUID()
  writeFileSync(passwordFile, password, { mode: 0o600 })
  return password
}

function resolveFfmpegPath(): string {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'ffmpeg', 'ffmpeg')
    if (existsSync(bundled)) return bundled
  }
  for (const candidate of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate
  }
  return 'ffmpeg'
}

function resolveFfprobePath(): string {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'ffmpeg', 'ffprobe')
    if (existsSync(bundled)) return bundled
  }
  for (const candidate of ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe']) {
    if (existsSync(candidate)) return candidate
  }
  return 'ffprobe'
}

export function startEmbeddedServer(): void {
  const bundlePath = getServerBundlePath()
  if (!existsSync(bundlePath)) {
    console.warn(`[server] bundle not found at ${bundlePath} — embedded server will not start`)
    return
  }

  const dataDir = getServerDataDir()
  mkdirSync(dataDir, { recursive: true })

  const inherited: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
  )

  const env: Record<string, string> = {
    ...inherited,
    NODE_ENV: 'production',
    ABF_HOST: '0.0.0.0',
    ABF_PORT: String(EMBEDDED_SERVER_PORT),
    ABF_WEB_PASSWORD: getOrCreatePassword(),
    ABF_DATA_DIR: dataDir,
    ABF_WEB_ROOT: getWebRootPath(),
    ABF_FFMPEG_PATH: resolveFfmpegPath(),
    ABF_FFPROBE_PATH: resolveFfprobePath(),
    ABF_WHISPER_CPU_PATH:
      inherited['ABF_WHISPER_CPU_PATH'] ??
      (app.isPackaged
        ? join(process.resourcesPath, 'whisper', 'whisper-cli')
        : '/usr/local/bin/whisper-cli'),
    ABF_WHISPER_ALLOW_GPU: 'true'
  }

  serverProcess = utilityProcess.fork(bundlePath, [], { env, stdio: 'pipe' })

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[server] ${chunk}`)
  })

  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[server] ${chunk}`)
  })

  serverProcess.on('exit', (code) => {
    console.log(`[server] exited (code ${code ?? 'unknown'})`)
    serverProcess = null
  })
}

export function stopEmbeddedServer(): void {
  serverProcess?.kill()
  serverProcess = null
}

export function getEmbeddedServerPort(): number {
  return EMBEDDED_SERVER_PORT
}
