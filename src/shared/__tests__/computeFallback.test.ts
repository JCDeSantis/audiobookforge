import { describe, expect, it } from 'vitest'
import { classifyCudaFailure } from '../computeFallback'
import { WINDOWS_MISSING_DEPENDENCY_EXIT_CODE } from '../whisperExitCodes'

describe('CUDA failure classification', () => {
  it('recognizes a missing Windows CUDA dependency', () => {
    expect(classifyCudaFailure(WINDOWS_MISSING_DEPENDENCY_EXIT_CODE, '')).toBe('missing-runtime')
  })

  it('recognizes CUDA OOM and device failures', () => {
    expect(classifyCudaFailure(1, 'ggml_cuda: CUDA error: out of memory')).toBe('out-of-memory')
    expect(classifyCudaFailure(1, 'CUDA device lost during execution')).toBe('device-lost')
  })

  it('does not hide unrelated model or input failures behind CPU fallback', () => {
    expect(classifyCudaFailure(1, 'failed to load model: invalid tensor')).toBeNull()
    expect(classifyCudaFailure(1, 'could not decode input audio')).toBeNull()
  })
})
