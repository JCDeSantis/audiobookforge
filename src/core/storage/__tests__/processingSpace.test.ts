import { describe, expect, it } from 'vitest'
import { estimateProcessingBytes, isDiskFullError } from '../processingSpace'

describe('processing space estimation', () => {
  it('keeps a minimum workspace for small inputs', () => {
    expect(estimateProcessingBytes([10 * 1024 * 1024])).toBe(2 * 1024 * 1024 * 1024)
  })

  it('scales compressed audiobook inputs for decoded PCM working data', () => {
    expect(estimateProcessingBytes([1024 * 1024 * 1024])).toBe(12 * 1024 * 1024 * 1024)
  })

  it('recognizes operating-system and FFmpeg disk exhaustion errors', () => {
    expect(isDiskFullError(new Error('write ENOSPC'))).toBe(true)
    expect(isDiskFullError('No space left on device')).toBe(true)
    expect(isDiskFullError('invalid media')).toBe(false)
  })
})
