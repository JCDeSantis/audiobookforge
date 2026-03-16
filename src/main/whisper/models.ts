import { app } from 'electron'
import { join } from 'path'
import { existsSync, statSync } from 'fs'
import { unlink } from 'fs/promises'
import type { WhisperModel, WhisperModelInfo } from '../../shared/types'

export const WHISPER_MODELS: WhisperModelInfo[] = [
  {
    id: 'tiny',
    name: 'Tiny',
    size: '78 MB',
    sizeBytes: 77704960,
    description: 'Fastest - basic accuracy, good for clear narration'
  },
  {
    id: 'base',
    name: 'Base',
    size: '148 MB',
    sizeBytes: 147964832,
    description: 'Fast - solid accuracy for most audiobooks'
  },
  {
    id: 'small',
    name: 'Small',
    size: '488 MB',
    sizeBytes: 487636544,
    description: 'Balanced - recommended for best results'
  },
  {
    id: 'medium',
    name: 'Medium',
    size: '1.5 GB',
    sizeBytes: 1533774848,
    description: 'Slow - highest accuracy, multiple speakers'
  },
  {
    id: 'large-v3-turbo-q5_0',
    name: 'Large V3 Turbo',
    size: '547 MB',
    sizeBytes: 573741056,
    description: 'Best with GPU - state-of-the-art encoder, fast quantized inference'
  },
  {
    id: 'large-v3-turbo',
    name: 'Large V3 Turbo (Full)',
    size: '1.6 GB',
    sizeBytes: 1739146240,
    description: 'Maximum quality - full-precision Large V3 Turbo'
  }
]

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export function getModelUrl(model: WhisperModel): string {
  return `${HF_BASE}/ggml-${model}.bin`
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
    return size === info.sizeBytes
  } catch {
    return false
  }
}
