import { app } from 'electron'
import { join } from 'path'
import { existsSync, statSync } from 'fs'
import { unlink } from 'fs/promises'
import type { WhisperModel } from '../../shared/types'
import { isWhisperModelSizeAcceptable } from '../../shared/whisperModelValidation'
import { getWhisperModelUrl, WHISPER_MODELS } from '../../shared/whisperModels'

export { WHISPER_MODELS }

export function getModelUrl(model: WhisperModel): string {
  return getWhisperModelUrl(model)
}

export function getModelDir(): string {
  return join(app.getPath('userData'), 'whisper', 'models')
}

export function getModelPath(model: WhisperModel): string {
  return join(getModelDir(), `ggml-${model}.bin`)
}

export async function deleteModel(model: WhisperModel): Promise<void> {
  await unlink(getModelPath(model)).catch(() => {})
}

export function isModelDownloaded(model: WhisperModel): boolean {
  const modelPath = getModelPath(model)
  if (!existsSync(modelPath)) return false

  const info = WHISPER_MODELS.find((entry) => entry.id === model)
  if (!info) {
    return false
  }

  try {
    const { size } = statSync(modelPath)
    return isWhisperModelSizeAcceptable(size, info.sizeBytes)
  } catch {
    return false
  }
}
