import { describe, expect, it } from 'vitest'
import {
  buildOverlappingSegments,
  buildSegments,
  buildSegmentsFromChapters,
  findLargeInternalGaps,
  replaceCueRange
} from '../segments'

describe('buildSegments', () => {
  it('keeps full coverage when a silence falls near a forced split', () => {
    const segments = buildSegments([[1180, 1205]], 2400)

    expect(segments).toHaveLength(2)
    expect(segments[0].startSec).toBe(0)
    expect(segments[0].endSec).toBeGreaterThanOrEqual(segments[1].startSec)
    expect(segments[1].endSec).toBe(2400)
  })

  it('uses silence as a preferred split point without dropping the interval', () => {
    const segments = buildSegments([[1000, 1100]], 1300)

    expect(segments).toHaveLength(2)
    expect(segments[0].endSec).toBeGreaterThanOrEqual(segments[1].startSec)
    expect(segments[0].endSec).toBeGreaterThan(1049)
    expect(segments[1].startSec).toBeLessThan(1051)
  })

  it('falls back to max-sized continuous chunks when no silences exist', () => {
    const segments = buildSegments([], 2600)

    expect(segments.length).toBe(3)
    expect(segments[0].startSec).toBe(0)
    expect(segments[0].endSec).toBeGreaterThanOrEqual(segments[1].startSec)
    expect(segments[1].endSec).toBeGreaterThanOrEqual(segments[2].startSec)
    expect(segments[2].endSec).toBe(2600)
  })

  it('uses chapter endings as preferred split points for single-file books', () => {
    const segments = buildSegmentsFromChapters(
      [
        { startSec: 0, endSec: 300 },
        { startSec: 300, endSec: 900 },
        { startSec: 900, endSec: 1400 }
      ],
      1400
    )

    expect(segments).toHaveLength(2)
    expect(segments[0].startSec).toBe(0)
    expect(segments[0].endSec).toBeGreaterThanOrEqual(segments[1].startSec)
    expect(segments[0].endSec).toBeGreaterThan(899)
    expect(segments[1].endSec).toBe(1400)
  })

  it('splits oversized chapters into max-sized continuous chunks', () => {
    const segments = buildSegmentsFromChapters([{ startSec: 0, endSec: 2000 }], 2000)

    expect(segments).toHaveLength(2)
    expect(segments[0].startSec).toBe(0)
    expect(segments[0].endSec).toBeGreaterThanOrEqual(segments[1].startSec)
    expect(segments[0].durationSec).toBeGreaterThan(1199)
    expect(segments[1].endSec).toBe(2000)
  })

  it('builds overlapping retry windows that cover the full duration', () => {
    const segments = buildOverlappingSegments(500, 240, 8)

    expect(segments).toHaveLength(3)
    expect(segments[0].startSec).toBe(0)
    expect(segments[0].endSec).toBe(240)
    expect(segments[1].startSec).toBe(232)
    expect(segments[1].endSec).toBe(472)
    expect(segments[2].startSec).toBe(464)
    expect(segments[2].endSec).toBe(500)
  })

  it('finds large internal gaps between subtitle cues', () => {
    const gaps = findLargeInternalGaps(
      [
        { startSec: 0, endSec: 4, text: 'first' },
        { startSec: 18, endSec: 22, text: 'second' },
        { startSec: 24, endSec: 26, text: 'third' }
      ],
      10
    )

    expect(gaps).toEqual([{ startSec: 4, endSec: 18, durationSec: 14 }])
  })

  it('replaces a cue range with repaired cues', () => {
    const cues = replaceCueRange(
      [
        { startSec: 0, endSec: 4, text: 'first' },
        { startSec: 20, endSec: 23, text: 'third' }
      ],
      4,
      20,
      [
        { startSec: 5, endSec: 9, text: 'second' },
        { startSec: 20, endSec: 23, text: 'third' }
      ]
    )

    expect(cues).toHaveLength(3)
    expect(cues[0].text).toBe('first')
    expect(cues[1].text).toBe('second')
    expect(cues[2].text).toBe('third')
  })
})
