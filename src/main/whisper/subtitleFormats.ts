import type { SubtitleFormat } from '../../shared/types'
import { parseSrtContent } from './segments'

function formatVttTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

function formatLrcTimestamp(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100))
  const minutes = Math.floor(centiseconds / 6000)
  const secs = Math.floor((centiseconds % 6000) / 100)
  const fraction = centiseconds % 100

  return `[${minutes.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}.${fraction.toString().padStart(2, '0')}]`
}

export function convertSrtToFormat(srt: string, format: SubtitleFormat): string {
  if (format === 'srt') return srt

  const cues = parseSrtContent(srt)
  if (format === 'vtt') {
    const body = cues
      .map(
        (cue) =>
          `${formatVttTimestamp(cue.startSec)} --> ${formatVttTimestamp(cue.endSec)}\n${cue.text}`
      )
      .join('\n\n')
    return `WEBVTT\n\n${body}${body ? '\n' : ''}`
  }

  return cues
    .map((cue) => `${formatLrcTimestamp(cue.startSec)}${cue.text.replace(/\s*\n\s*/g, ' ')}`)
    .join('\n')
    .concat(cues.length > 0 ? '\n' : '')
}

export function getSubtitleMimeType(format: SubtitleFormat): string {
  if (format === 'vtt') return 'text/vtt'
  if (format === 'lrc') return 'text/plain'
  return 'application/x-subrip'
}
