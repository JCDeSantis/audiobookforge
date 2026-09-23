import type { WhisperModel } from '../../../shared/types'
export { WHISPER_MODELS } from '../../../shared/whisperModels'
import { WHISPER_MODELS } from '../../../shared/whisperModels'

const MODEL_BASE_NAME_OVERRIDES: Partial<Record<WhisperModel, string>> = {
  'large-v2': 'Large V2',
  'large-v3': 'Large V3'
}

export function getWhisperModelBaseName(modelId: WhisperModel): string {
  const model = WHISPER_MODELS.find((entry) => entry.id === modelId)

  if (model) {
    return model.name.replace(/\s+\([^)]*\)$/, '')
  }

  return MODEL_BASE_NAME_OVERRIDES[modelId] ?? modelId
}
