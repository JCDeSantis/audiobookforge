import type { SubtitleFormat } from './types'

interface Cue {
  startSec: number
  endSec: number
  text: string
}

function timestampSeconds(value: string): number {
  const match = value.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

function parseSrt(srt: string): Cue[] {
  return srt
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.split('\n'))
    .map((lines) => {
      const timingIndex = lines.findIndex((line) => line.includes('-->'))
      if (timingIndex < 0) return null
      const [start, end] = lines[timingIndex].split('-->')
      const text = lines.slice(timingIndex + 1).join('\n').trim()
      return text ? { startSec: timestampSeconds(start), endSec: timestampSeconds(end), text } : null
    })
    .filter((cue): cue is Cue => cue !== null)
}

function srtTimestamp(seconds: number): string {
  return vttTimestamp(seconds).replace('.', ',')
}

export function splitSrtByDurations(srt: string, durations: number[]): string[] {
  const cues = parseSrt(srt)
  let offset = 0
  return durations.map((duration) => {
    const start = offset
    const end = start + Math.max(0, duration)
    offset = end
    const part = cues.flatMap((cue) => {
      const overlapStart = Math.max(cue.startSec, start)
      const overlapEnd = Math.min(cue.endSec, end)
      return overlapEnd > overlapStart
        ? [{ startSec: overlapStart - start, endSec: overlapEnd - start, text: cue.text }]
        : []
    })
    return part
      .map(
        (cue, index) =>
          `${index + 1}\n${srtTimestamp(cue.startSec)} --> ${srtTimestamp(cue.endSec)}\n${cue.text}`
      )
      .join('\n\n')
      .concat(part.length ? '\n' : '')
  })
}

function vttTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

function lrcTimestamp(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100))
  const minutes = Math.floor(centiseconds / 6000)
  const secs = Math.floor((centiseconds % 6000) / 100)
  const fraction = centiseconds % 100
  return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${fraction.toString().padStart(2, '0')}]`
}

export function convertSrtToFormat(srt: string, format: SubtitleFormat): string {
  if (format === 'srt') return srt
  const cues = parseSrt(srt)
  if (format === 'vtt') {
    const body = cues
      .map((cue) => `${vttTimestamp(cue.startSec)} --> ${vttTimestamp(cue.endSec)}\n${cue.text}`)
      .join('\n\n')
    return `WEBVTT\n\n${body}${body ? '\n' : ''}`
  }
  return cues
    .map((cue) => `${lrcTimestamp(cue.startSec)}${cue.text.replace(/\s*\n\s*/g, ' ')}`)
    .join('\n')
    .concat(cues.length ? '\n' : '')
}

export function getSubtitleMimeType(format: SubtitleFormat): string {
  if (format === 'vtt') return 'text/vtt'
  if (format === 'lrc') return 'text/plain'
  return 'application/x-subrip'
}
