import { describe, expect, it } from 'vitest'
import { convertSrtToFormat, getSubtitleMimeType, splitSrtByDurations } from '../subtitleFormats'

const SRT = `1
00:00:01,250 --> 00:00:03,500
First line

2
01:02:03,040 --> 01:02:05,900
Second
line
`

describe('subtitle format conversion', () => {
  it('converts SRT cues to WebVTT', () => {
    expect(convertSrtToFormat(SRT, 'vtt')).toBe(`WEBVTT

00:00:01.250 --> 00:00:03.500
First line

01:02:03.040 --> 01:02:05.900
Second
line
`)
  })

  it('converts SRT cue starts to LRC timestamps and flattens multiline text', () => {
    expect(convertSrtToFormat(SRT, 'lrc')).toBe(`[00:01.25]First line
[62:03.04]Second line
`)
  })

  it('keeps SRT unchanged and exposes upload MIME types', () => {
    expect(convertSrtToFormat(SRT, 'srt')).toBe(SRT)
    expect(getSubtitleMimeType('srt')).toBe('application/x-subrip')
    expect(getSubtitleMimeType('vtt')).toBe('text/vtt')
    expect(getSubtitleMimeType('lrc')).toBe('text/plain')
  })

  it('splits merged cues onto per-file timelines for ABS multipart delivery', () => {
    const parts = splitSrtByDurations(
      `1\n00:00:09,000 --> 00:00:11,000\nAcross boundary\n`,
      [10, 10]
    )
    expect(parts[0]).toContain('00:00:09,000 --> 00:00:10,000')
    expect(parts[1]).toContain('00:00:00,000 --> 00:00:01,000')
  })
})
