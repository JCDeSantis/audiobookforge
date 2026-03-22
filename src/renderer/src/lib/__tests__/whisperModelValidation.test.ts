import { describe, expect, it } from 'vitest'
import {
  getWhisperModelSizeTolerance,
  isWhisperModelSizeAcceptable
} from '../../../../shared/whisperModelValidation'

describe('whisper model validation', () => {
  it('accepts a small size drift for known model files', () => {
    const staleExpectedBytes = 573741056
    const actualBytes = 574041195

    expect(isWhisperModelSizeAcceptable(actualBytes, staleExpectedBytes)).toBe(true)
  })

  it('rejects clearly incomplete downloads', () => {
    const expectedBytes = 574041195
    const tolerance = getWhisperModelSizeTolerance(expectedBytes)

    expect(isWhisperModelSizeAcceptable(expectedBytes - tolerance - 1, expectedBytes)).toBe(
      false
    )
  })

  it('accepts the exact expected file size', () => {
    const expectedBytes = 574041195

    expect(isWhisperModelSizeAcceptable(expectedBytes, expectedBytes)).toBe(true)
  })

  it('accepts the current full large v3 turbo model size', () => {
    const expectedBytes = 1624555275

    expect(isWhisperModelSizeAcceptable(expectedBytes, expectedBytes)).toBe(true)
  })
})
