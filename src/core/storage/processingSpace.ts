import { statfsSync } from 'fs'

export const DEFAULT_STORAGE_RESERVE_BYTES = 5 * 1024 * 1024 * 1024
const MINIMUM_PROCESSING_BYTES = 2 * 1024 * 1024 * 1024
const DECODED_AUDIO_FACTOR = 12

export function estimateProcessingBytes(inputSizes: number[]): number {
  const compressedBytes = inputSizes.reduce(
    (total, size) => total + (Number.isFinite(size) && size > 0 ? size : 0),
    0
  )
  return Math.max(MINIMUM_PROCESSING_BYTES, compressedBytes * DECODED_AUDIO_FACTOR)
}

export function availableBytes(path: string): number {
  const stats = statfsSync(path)
  return Number(stats.bavail) * Number(stats.bsize)
}

export function assertFreeProcessingSpace(
  root: string,
  requiredBytes: number,
  reserveBytes = DEFAULT_STORAGE_RESERVE_BYTES
): void {
  const available = availableBytes(root)
  if (available - requiredBytes < reserveBytes) {
    const requiredGiB = ((requiredBytes + reserveBytes) / 1024 ** 3).toFixed(1)
    const availableGiB = (available / 1024 ** 3).toFixed(1)
    throw new Error(
      `Not enough free space for transcription. Approximately ${requiredGiB} GiB is required including reserve; ${availableGiB} GiB is available.`
    )
  }
}

export function isDiskFullError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value)
  return /ENOSPC|no space left on device|disk full/i.test(message)
}
