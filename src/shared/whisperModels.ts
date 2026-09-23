import type { WhisperModel, WhisperModelInfo } from './types'

export const WHISPER_MODELS: WhisperModelInfo[] = [
  { id: 'tiny', name: 'Tiny', size: '78 MB', sizeBytes: 77704960, description: 'Fastest - basic accuracy' },
  { id: 'base', name: 'Base', size: '148 MB', sizeBytes: 147964832, description: 'Fast - good accuracy' },
  { id: 'small', name: 'Small', size: '488 MB', sizeBytes: 487636544, description: 'Balanced - recommended' },
  { id: 'medium', name: 'Medium', size: '1.5 GB', sizeBytes: 1533774848, description: 'Slow - best accuracy' },
  {
    id: 'large-v3-turbo-q5_0',
    name: 'Large V3 Turbo',
    size: '547 MB',
    sizeBytes: 574041195,
    description: 'Best with GPU - state-of-the-art encoder, fast quantized inference'
  },
  {
    id: 'large-v3-turbo',
    name: 'Large V3 Turbo (Full)',
    size: '1.51 GB',
    sizeBytes: 1624555275,
    description: 'Maximum quality - full-precision Large V3 Turbo'
  }
]

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export function getWhisperModelUrl(model: WhisperModel): string {
  return `${HF_BASE}/ggml-${model}.bin`
}

export function isSupportedWhisperModel(value: unknown): value is WhisperModel {
  return typeof value === 'string' && WHISPER_MODELS.some((model) => model.id === value)
}
