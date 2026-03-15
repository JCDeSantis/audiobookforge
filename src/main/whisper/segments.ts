const MIN_SEGMENT_S = 60    // merge segments shorter than this into a neighbor
const MAX_SEGMENT_S = 1200  // hard-split segments longer than this (20 min cap)
const PAD_S = 0.35          // expand each boundary by this many seconds

export interface AudioSegment {
  index: number
  startSec: number   // padded and clamped to [0, totalDuration]
  endSec: number     // padded and clamped to [0, totalDuration]
  durationSec: number
}

/**
 * Parse silence_start / silence_end lines from ffmpeg silencedetect stderr.
 */
export function parseSilences(stderr: string): [number, number][] {
  const starts: number[] = []
  const ends: number[] = []

  const startRe = /silence_start:\s*([\d.]+)/g
  const endRe = /silence_end:\s*([\d.]+)/g

  let m: RegExpExecArray | null
  while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]))
  while ((m = endRe.exec(stderr)) !== null) ends.push(parseFloat(m[1]))

  // Pair up starts and ends (audio ending mid-silence produces an unpaired start)
  const len = Math.min(starts.length, ends.length)
  const silences: [number, number][] = []
  for (let i = 0; i < len; i++) {
    silences.push([starts[i], ends[i]])
  }
  return silences
}

/**
 * Convert silence intervals into speech segments, apply MIN/MAX rules, and add padding.
 */
export function buildSegments(
  silences: [number, number][],
  totalDuration: number
): AudioSegment[] {
  // Step 1: Invert silence intervals to get raw speech blocks
  const rawSpeech: [number, number][] = []
  let cursor = 0
  for (const [silStart, silEnd] of silences) {
    if (silStart > cursor) rawSpeech.push([cursor, silStart])
    cursor = silEnd
  }
  if (cursor < totalDuration) rawSpeech.push([cursor, totalDuration])
  if (rawSpeech.length === 0) rawSpeech.push([0, totalDuration]) // no silences at all

  // Step 2: Greedily combine speech blocks into chunks ≤ MAX_SEGMENT_S
  // (silence gaps between speech blocks are included in the span)
  const chunks: [number, number][] = []
  let [chunkStart, chunkEnd] = rawSpeech[0]
  for (let i = 1; i < rawSpeech.length; i++) {
    const segEnd = rawSpeech[i][1]
    if (segEnd - chunkStart <= MAX_SEGMENT_S) {
      chunkEnd = segEnd
    } else {
      chunks.push([chunkStart, chunkEnd])
      chunkStart = rawSpeech[i][0]
      chunkEnd = segEnd
    }
  }
  chunks.push([chunkStart, chunkEnd])

  // Step 3: Hard-split any single chunk that still exceeds MAX (e.g. no silences for 30 min)
  const splitChunks: [number, number][] = []
  for (const [s, e] of chunks) {
    if (e - s > MAX_SEGMENT_S) {
      let pos = s
      while (pos < e) {
        const end = Math.min(pos + MAX_SEGMENT_S, e)
        splitChunks.push([pos, end])
        pos = end
      }
    } else {
      splitChunks.push([s, e])
    }
  }

  // Step 4: Absorb trailing tiny segments (< MIN) into the previous chunk
  const merged: [number, number][] = []
  for (const chunk of splitChunks) {
    const dur = chunk[1] - chunk[0]
    if (dur < MIN_SEGMENT_S && merged.length > 0) {
      merged[merged.length - 1] = [merged[merged.length - 1][0], chunk[1]]
    } else {
      merged.push([chunk[0], chunk[1]])
    }
  }

  // Step 5: Apply padding and build AudioSegment objects
  return merged.map(([s, e], index) => {
    const startSec = Math.max(0, s - PAD_S)
    const endSec = Math.min(totalDuration, e + PAD_S)
    return { index, startSec, endSec, durationSec: endSec - startSec }
  })
}

/**
 * Add offsetSeconds to every timestamp in an SRT file's content string.
 */
export function offsetSrtContent(srtContent: string, offsetSeconds: number): string {
  if (offsetSeconds === 0) return srtContent
  return srtContent.replace(
    /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/g,
    (_, h1, m1, s1, ms1, h2, m2, s2, ms2) => {
      const t1 = toSec(h1, m1, s1, ms1) + offsetSeconds
      const t2 = toSec(h2, m2, s2, ms2) + offsetSeconds
      return `${fromSec(Math.max(0, t1))} --> ${fromSec(Math.max(0, t2))}`
    }
  )
}

function toSec(h: string, m: string, s: string, ms: string): number {
  return +h * 3600 + +m * 60 + +s + +ms / 1000
}

function fromSec(totalSec: number): string {
  const ms = Math.round((totalSec % 1) * 1000)
  const sec = Math.floor(totalSec) % 60
  const min = Math.floor(totalSec / 60) % 60
  const hr = Math.floor(totalSec / 3600)
  return `${p2(hr)}:${p2(min)}:${p2(sec)},${p3(ms)}`
}

function p2(n: number): string { return String(n).padStart(2, '0') }
function p3(n: number): string { return String(n).padStart(3, '0') }

/**
 * Merge multiple SRT content strings into one, renumbering blocks sequentially.
 */
export function mergeSrts(srtContents: string[]): string {
  let counter = 1
  const outputBlocks: string[] = []

  for (const content of srtContents) {
    if (!content.trim()) continue
    const blocks = content.trim().split(/\n\s*\n/)
    for (const block of blocks) {
      const lines = block.trim().split('\n')
      if (lines.length < 2) continue
      // Replace the first line (subtitle index) with the new sequential number
      outputBlocks.push([String(counter++), ...lines.slice(1)].join('\n'))
    }
  }

  return outputBlocks.join('\n\n') + '\n'
}

/**
 * Convert a total-seconds value to the HH:MM:SS format used for segmentTimestamp.
 */
export function secondsToTimestamp(totalSec: number): string {
  const sec = Math.floor(totalSec) % 60
  const min = Math.floor(totalSec / 60) % 60
  const hr = Math.floor(totalSec / 3600)
  return `${p2(hr)}:${p2(min)}:${p2(sec)}`
}
