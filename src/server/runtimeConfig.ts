import { resolve } from 'path'
import { createDataPaths, type DataPaths } from '../core/platform/dataPaths'

export interface ServerRuntimeConfig {
  host: string
  port: number
  dataPaths: DataPaths
  passwordFile: string | null
  password: string | null
  trustProxy: boolean
  sessionSecretFile: string
  webRoot: string
  ffmpegPath: string
  whisperCpuPath: string
  whisperCudaPath: string
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3000
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ABF_PORT must be an integer between 1 and 65535.')
  }
  return port
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('ABF_TRUST_PROXY must be true or false.')
}

export function loadServerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): ServerRuntimeConfig {
  const dataRoot = resolve(environment.ABF_DATA_DIR?.trim() || '/data')
  const passwordFile = environment.ABF_WEB_PASSWORD_FILE?.trim() || null
  const password = environment.ABF_WEB_PASSWORD || null

  if (!passwordFile && !password) {
    throw new Error('Set ABF_WEB_PASSWORD_FILE or ABF_WEB_PASSWORD before starting the web server.')
  }

  return {
    host: environment.ABF_HOST?.trim() || '0.0.0.0',
    port: parsePort(environment.ABF_PORT),
    dataPaths: createDataPaths(dataRoot),
    passwordFile: passwordFile ? resolve(passwordFile) : null,
    password,
    trustProxy: parseBoolean(environment.ABF_TRUST_PROXY),
    sessionSecretFile: resolve(
      environment.ABF_SESSION_SECRET_FILE?.trim() ||
        resolve(dataRoot, 'config', 'session-secret.key')
    ),
    webRoot: resolve(environment.ABF_WEB_ROOT?.trim() || resolve(process.cwd(), 'out', 'renderer')),
    ffmpegPath: environment.ABF_FFMPEG_PATH?.trim() || '/usr/bin/ffmpeg',
    whisperCpuPath:
      environment.ABF_WHISPER_CPU_PATH?.trim() || '/opt/audiobookforge/whisper/cpu/whisper-cli',
    whisperCudaPath:
      environment.ABF_WHISPER_CUDA_PATH?.trim() || '/opt/audiobookforge/whisper/cuda/whisper-cli'
  }
}
