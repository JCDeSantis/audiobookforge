import type { WhisperModelInfo } from '@shared/types'

export const WHISPER_MODELS: WhisperModelInfo[] = [
  {
    id: 'tiny',
    name: 'Tiny',
    size: '78 MB',
    sizeBytes: 77704960,
    description: 'Fastest — basic accuracy'
  },
  {
    id: 'base',
    name: 'Base',
    size: '148 MB',
    sizeBytes: 147964832,
    description: 'Fast — good accuracy'
  },
  {
    id: 'small',
    name: 'Small',
    size: '488 MB',
    sizeBytes: 487636544,
    description: 'Balanced — recommended'
  },
  {
    id: 'medium',
    name: 'Medium',
    size: '1.5 GB',
    sizeBytes: 1533774848,
    description: 'Slow — best accuracy'
  },
  {
    id: 'large-v3-turbo-q5_0',
    name: 'Large V3 Turbo',
    size: '547 MB',
    sizeBytes: 573741056,
    description: 'Best with GPU — state-of-the-art encoder, fast quantized inference'
  },
  {
    id: 'large-v3-turbo',
    name: 'Large V3 Turbo (Full)',
    size: '1.6 GB',
    sizeBytes: 1739146240,
    description: 'Maximum quality — full-precision Large V3 Turbo'
  }
]
