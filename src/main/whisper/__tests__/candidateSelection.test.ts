import { describe, expect, it } from 'vitest'
import { shouldPreferCueCandidate } from '../candidateSelection'
import type { SubtitleCue } from '../segments'

const GAP_THRESHOLD_S = 10

function cue(startSec: number, endSec: number, text: string): SubtitleCue {
  return { startSec, endSec, text }
}

describe('shouldPreferCueCandidate', () => {
  it('prefers a candidate that removes a 30-second internal gap', () => {
    const currentCues = [cue(0, 100, 'a'), cue(130, 230, 'b')]
    const candidateCues = [cue(0, 175, 'joined')]

    expect(shouldPreferCueCandidate(currentCues, candidateCues, GAP_THRESHOLD_S)).toBe(true)
  })

  it('prefers a gap-free repair candidate when it lands just under the prior long-segment floor', () => {
    const currentCues = [cue(0, 200, 'a'), cue(230, 430, 'b')]
    const candidateCues = [cue(0, 179, 'recovered hole')]

    expect(shouldPreferCueCandidate(currentCues, candidateCues, GAP_THRESHOLD_S)).toBe(true)
  })

  it('does not prefer a gap-free candidate with catastrophic coverage loss', () => {
    const currentCues = [cue(0, 100, 'a'), cue(130, 230, 'b')]
    const candidateCues = [cue(0, 20, 'too short')]

    expect(shouldPreferCueCandidate(currentCues, candidateCues, GAP_THRESHOLD_S)).toBe(false)
  })

  it('prefers fewer large gaps when coverage drop is bounded by removed gap size', () => {
    const currentCues = [cue(0, 90, 'a'), cue(115, 180, 'b')]
    const candidateCues = [cue(0, 80, 'a'), cue(95, 170, 'b')]

    expect(shouldPreferCueCandidate(currentCues, candidateCues, GAP_THRESHOLD_S)).toBe(true)
  })

  it('prefers higher coverage when both candidates have the same gap profile', () => {
    const currentCues = [cue(0, 40, 'a'), cue(45, 80, 'b')]
    const candidateCues = [cue(0, 40, 'a'), cue(45, 85, 'b')]

    expect(shouldPreferCueCandidate(currentCues, candidateCues, GAP_THRESHOLD_S)).toBe(true)
  })
})
