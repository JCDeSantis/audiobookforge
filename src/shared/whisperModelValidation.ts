const MIN_MODEL_SIZE_TOLERANCE_BYTES = 64 * 1024
const RELATIVE_MODEL_SIZE_TOLERANCE = 0.001

export function getWhisperModelSizeTolerance(expectedBytes: number): number {
  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    return 0
  }

  return Math.max(
    MIN_MODEL_SIZE_TOLERANCE_BYTES,
    Math.round(expectedBytes * RELATIVE_MODEL_SIZE_TOLERANCE)
  )
}

export function isWhisperModelSizeAcceptable(
  actualBytes: number,
  expectedBytes: number
): boolean {
  if (!Number.isFinite(actualBytes) || actualBytes <= 0) {
    return false
  }

  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    return false
  }

  return Math.abs(actualBytes - expectedBytes) <= getWhisperModelSizeTolerance(expectedBytes)
}
