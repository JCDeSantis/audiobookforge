import type { TranscriptionQualityIssue, TranscriptionQualityReport } from '../../shared/types'
import type { SubtitleCue } from './segments'
import { findLargeInternalGaps } from './segments'

const LARGE_GAP_WARNING_S = 12
const LONG_CUE_WARNING_S = 18
const LOW_COVERAGE_WARNING_PERCENT = 35
const MAX_ISSUES = 20

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function detectRepeatedText(cues: SubtitleCue[]): TranscriptionQualityIssue[] {
  const issues: TranscriptionQualityIssue[] = []
  let previous = ''
  let repeatCount = 0

  for (const cue of cues) {
    const current = normalizeText(cue.text)
    if (current && current === previous) {
      repeatCount += 1
      if (repeatCount === 1) {
        issues.push({
          severity: 'warning',
          code: 'repeated-text',
          message: `Repeated subtitle text near ${Math.round(cue.startSec)}s.`,
          startSec: cue.startSec,
          endSec: cue.endSec
        })
      }
    } else {
      repeatCount = 0
    }

    previous = current
  }

  return issues
}

export function createQualityReport(
  cues: SubtitleCue[],
  durationSec: number,
  extraIssues: TranscriptionQualityIssue[] = []
): TranscriptionQualityReport {
  const safeDurationSec = Math.max(0, durationSec)
  const coverageSec = cues.reduce(
    (total, cue) => total + Math.max(0, cue.endSec - cue.startSec),
    0
  )
  const coveragePercent =
    safeDurationSec > 0 ? Math.round((coverageSec / safeDurationSec) * 1000) / 10 : 0
  const gaps = findLargeInternalGaps(cues, LARGE_GAP_WARNING_S)
  const longestCueSec = cues.reduce(
    (longest, cue) => Math.max(longest, Math.max(0, cue.endSec - cue.startSec)),
    0
  )
  const issues: TranscriptionQualityIssue[] = []

  if (cues.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-cues',
      message: 'No subtitle cues were generated.'
    })
  }

  if (safeDurationSec > 0 && coveragePercent < LOW_COVERAGE_WARNING_PERCENT) {
    issues.push({
      severity: 'warning',
      code: 'low-coverage',
      message: `Subtitle coverage is ${coveragePercent}%, which is lower than expected for an audiobook.`
    })
  }

  for (const gap of gaps.slice(0, 8)) {
    issues.push({
      severity: 'warning',
      code: 'large-gap',
      message: `Large subtitle gap of ${Math.round(gap.durationSec)}s detected.`,
      startSec: gap.startSec,
      endSec: gap.endSec
    })
  }

  for (const cue of cues) {
    const cueDuration = cue.endSec - cue.startSec
    if (cueDuration >= LONG_CUE_WARNING_S) {
      issues.push({
        severity: 'warning',
        code: 'long-cue',
        message: `Long subtitle cue of ${Math.round(cueDuration)}s detected.`,
        startSec: cue.startSec,
        endSec: cue.endSec
      })
    }
  }

  issues.push(...detectRepeatedText(cues), ...extraIssues)

  const limitedIssues = issues.slice(0, MAX_ISSUES)

  return {
    cueCount: cues.length,
    durationSec: Math.round(safeDurationSec * 100) / 100,
    coverageSec: Math.round(coverageSec * 100) / 100,
    coveragePercent,
    largestGapSec: Math.round((gaps[0]?.durationSec ?? 0) * 100) / 100,
    longestCueSec: Math.round(longestCueSec * 100) / 100,
    issueCount: issues.length,
    issues: limitedIssues,
    generatedAt: Date.now()
  }
}
