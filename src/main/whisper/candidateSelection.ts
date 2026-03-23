import { findLargeInternalGaps } from './segments'
import type { SubtitleCue } from './segments'

interface CueQualityStats {
  coverageSec: number
  largeGapCount: number
  largestLargeGapSec: number
}

function getCueCoverageSeconds(cues: SubtitleCue[]): number {
  return cues.reduce((total, cue) => total + Math.max(0, cue.endSec - cue.startSec), 0)
}

function summarizeCueQuality(cues: SubtitleCue[], gapThresholdSec: number): CueQualityStats {
  const largeGaps = findLargeInternalGaps(cues, gapThresholdSec)
  const largestLargeGapSec = largeGaps.reduce((largest, gap) => Math.max(largest, gap.durationSec), 0)

  return {
    coverageSec: getCueCoverageSeconds(cues),
    largeGapCount: largeGaps.length,
    largestLargeGapSec
  }
}

/**
 * Select the stronger subtitle candidate while weighting continuity over raw cue duration.
 * This avoids retaining transcripts that have large internal holes in long audio segments.
 */
export function shouldPreferCueCandidate(
  currentCues: SubtitleCue[],
  candidateCues: SubtitleCue[],
  gapThresholdSec: number
): boolean {
  if (candidateCues.length === 0) {
    return false
  }
  if (currentCues.length === 0) {
    return true
  }

  const current = summarizeCueQuality(currentCues, gapThresholdSec)
  const candidate = summarizeCueQuality(candidateCues, gapThresholdSec)

  if (candidate.largeGapCount === 0 && current.largeGapCount > 0) {
    const minimumCoverageToReplace = Math.max(
      8,
      current.largestLargeGapSec * 1.5,
      current.coverageSec * 0.4
    )
    return candidate.coverageSec >= minimumCoverageToReplace
  }

  if (candidate.largeGapCount < current.largeGapCount) {
    const allowedCoverageDrop = Math.max(20, current.largestLargeGapSec)
    if (candidate.coverageSec + allowedCoverageDrop >= current.coverageSec) {
      return true
    }
  }

  if (candidate.largestLargeGapSec + 3 < current.largestLargeGapSec) {
    const gapReduction = current.largestLargeGapSec - candidate.largestLargeGapSec
    const allowedCoverageDrop = Math.max(10, gapReduction * 0.75)
    if (candidate.coverageSec + allowedCoverageDrop >= current.coverageSec) {
      return true
    }
  }

  if (candidate.coverageSec > current.coverageSec + 5) {
    if (candidate.largeGapCount > current.largeGapCount + 1) {
      return false
    }
    return true
  }

  return (
    candidate.largeGapCount === current.largeGapCount && candidate.coverageSec > current.coverageSec
  )
}
