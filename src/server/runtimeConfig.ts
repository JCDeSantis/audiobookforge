import { resolve } from 'path'
import { createDataPaths, type DataPaths } from '../core/platform/dataPaths'
import { DEFAULT_FREE_SPACE_RESERVE_BYTES, DEFAULT_MAX_UPLOAD_BYTES } from './uploads/uploadStore'

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
  ffprobePath: string
  whisperCpuPath: string
  whisperCudaPath: string
  maxUploadBytes: number
  freeSpaceReserveBytes: number
  uploadRetentionMs: number
  resultRetentionMs: number
  checkpointRetentionMs: number
  retentionSweepIntervalMs: number
}

export function getServerRuntimeWarnings(config: ServerRuntimeConfig): string[] {
  const warnings: string[] = []
  if (!config.passwordFile && config.password) {
    warnings.push(
      'ABF_WEB_PASSWORD is set directly in the environment. Prefer ABF_WEB_PASSWORD_FILE or a Docker secret to reduce credential exposure.'
    )
  }
  return warnings
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

function parsePositiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`)
  return parsed
}

function parseRetentionDays(value: string | undefined, fallbackDays: number, name: string): number {
  return parsePositiveNumber(value, fallbackDays, name) * 24 * 60 * 60 * 1000
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
    ffprobePath: environment.ABF_FFPROBE_PATH?.trim() || '/usr/bin/ffprobe',
    whisperCpuPath:
      environment.ABF_WHISPER_CPU_PATH?.trim() || '/opt/audiobookforge/whisper/cpu/whisper-cli',
    whisperCudaPath:
      environment.ABF_WHISPER_CUDA_PATH?.trim() || '/opt/audiobookforge/whisper/cuda/whisper-cli',
    maxUploadBytes: parsePositiveNumber(
      environment.ABF_MAX_UPLOAD_BYTES,
      DEFAULT_MAX_UPLOAD_BYTES,
      'ABF_MAX_UPLOAD_BYTES'
    ),
    freeSpaceReserveBytes: parsePositiveNumber(
      environment.ABF_FREE_SPACE_RESERVE_BYTES,
      DEFAULT_FREE_SPACE_RESERVE_BYTES,
      'ABF_FREE_SPACE_RESERVE_BYTES'
    ),
    uploadRetentionMs: parseRetentionDays(
      environment.ABF_UPLOAD_RETENTION_DAYS,
      7,
      'ABF_UPLOAD_RETENTION_DAYS'
    ),
    resultRetentionMs: parseRetentionDays(
      environment.ABF_RESULT_RETENTION_DAYS,
      30,
      'ABF_RESULT_RETENTION_DAYS'
    ),
    checkpointRetentionMs: parseRetentionDays(
      environment.ABF_CHECKPOINT_RETENTION_DAYS,
      30,
      'ABF_CHECKPOINT_RETENTION_DAYS'
    ),
    retentionSweepIntervalMs:
      parsePositiveNumber(environment.ABF_RETENTION_SWEEP_HOURS, 6, 'ABF_RETENTION_SWEEP_HOURS') *
      60 *
      60 *
      1000
  }
}
