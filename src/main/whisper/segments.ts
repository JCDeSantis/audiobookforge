const MIN_SEGMENT_S = 60
const MAX_SEGMENT_S = 1200
const PAD_S = 0.35

export interface AudioSegment {
  index: number
  startSec: number
  endSec: number
  durationSec: number
}

export interface SubtitleCue {
  startSec: number
  endSec: number
  text: string
}

export interface SubtitleGap {
  startSec: number
  endSec: number
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

  const len = Math.min(starts.length, ends.length)
  const silences: [number, number][] = []
  for (let i = 0; i < len; i++) {
    silences.push([starts[i], ends[i]])
  }
  return silences
}

/**
 * Build continuous chunks across the full timeline.
 * Silences are used as preferred split points near the end of each chunk,
 * not as regions to omit from transcription.
 */
export function buildSegments(
  silences: [number, number][],
  totalDuration: number
): AudioSegment[] {
  const normalizedSilences = silences
    .map(([start, end]) => [Math.max(0, start), Math.min(totalDuration, end)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0])

  const mergedSilences: [number, number][] = []
  for (const silence of normalizedSilences) {
    const last = mergedSilences[mergedSilences.length - 1]
    if (!last || silence[0] > last[1]) {
      mergedSilences.push([...silence])
      continue
    }

    last[1] = Math.max(last[1], silence[1])
  }

  const chunks: [number, number][] = []
  let chunkStart = 0

  while (chunkStart < totalDuration) {
    const remaining = totalDuration - chunkStart
    if (remaining <= MAX_SEGMENT_S) {
      chunks.push([chunkStart, totalDuration])
      break
    }

    const minSplit = Math.min(totalDuration, chunkStart + MIN_SEGMENT_S)
    const maxSplit = Math.min(totalDuration, chunkStart + MAX_SEGMENT_S)
    let splitPoint: number | null = null

    for (const [silenceStart, silenceEnd] of mergedSilences) {
      if (silenceEnd <= minSplit) {
        continue
      }
      if (silenceStart >= maxSplit) {
        break
      }

      splitPoint = Math.max(minSplit, Math.min(maxSplit, (silenceStart + silenceEnd) / 2))
    }

    const chunkEnd = splitPoint ?? maxSplit
    if (chunkEnd <= chunkStart) {
      break
    }

    chunks.push([chunkStart, chunkEnd])
    chunkStart = chunkEnd
  }

  if (chunks.length > 1) {
    const lastChunk = chunks[chunks.length - 1]
    const lastDuration = lastChunk[1] - lastChunk[0]
    if (lastDuration < MIN_SEGMENT_S) {
      chunks[chunks.length - 2] = [chunks[chunks.length - 2][0], lastChunk[1]]
      chunks.pop()
    }
  }

  return chunks.map(([s, e], index) => {
    const startSec = Math.max(0, s - PAD_S)
    const endSec = Math.min(totalDuration, e + PAD_S)
    return { index, startSec, endSec, durationSec: endSec - startSec }
  })
}

/**
 * Build continuous chunks using embedded chapter endings as preferred split points.
 * This keeps full timeline coverage while avoiding silence detection for chapterized books.
 */
export function buildSegmentsFromChapters(
  chapters: Array<{ startSec: number; endSec: number }>,
  totalDuration: number
): AudioSegment[] {
  const preferredBoundaries = chapters
    .map((chapter) => Math.min(totalDuration, Math.max(0, chapter.endSec)))
    .filter((boundary) => boundary > 0 && boundary < totalDuration)
    .sort((left, right) => left - right)
    .filter((boundary, index, boundaries) => index === 0 || boundary > boundaries[index - 1])

  const chunks: [number, number][] = []
  let chunkStart = 0

  while (chunkStart < totalDuration) {
    const remaining = totalDuration - chunkStart
    if (remaining <= MAX_SEGMENT_S) {
      chunks.push([chunkStart, totalDuration])
      break
    }

    const minSplit = Math.min(totalDuration, chunkStart + MIN_SEGMENT_S)
    const maxSplit = Math.min(totalDuration, chunkStart + MAX_SEGMENT_S)
    const splitPoint =
      [...preferredBoundaries].reverse().find((boundary) => boundary >= minSplit && boundary <= maxSplit) ??
      maxSplit

    if (splitPoint <= chunkStart) {
      break
    }

    chunks.push([chunkStart, splitPoint])
    chunkStart = splitPoint
  }

  if (chunks.length > 1) {
    const lastChunk = chunks[chunks.length - 1]
    const lastDuration = lastChunk[1] - lastChunk[0]
    if (lastDuration < MIN_SEGMENT_S) {
      chunks[chunks.length - 2] = [chunks[chunks.length - 2][0], lastChunk[1]]
      chunks.pop()
    }
  }

  return chunks.map(([s, e], index) => {
    const startSec = Math.max(0, s - PAD_S)
    const endSec = Math.min(totalDuration, e + PAD_S)
    return { index, startSec, endSec, durationSec: endSec - startSec }
  })
}

export function buildOverlappingSegments(
  totalDuration: number,
  windowDuration: number,
  overlapDuration: number
): AudioSegment[] {
  if (totalDuration <= 0) return []

  const safeWindowDuration = Math.max(1, windowDuration)
  const safeOverlapDuration = Math.max(0, Math.min(overlapDuration, safeWindowDuration / 2))
  const step = Math.max(1, safeWindowDuration - safeOverlapDuration)
  const windows: AudioSegment[] = []

  let startSec = 0
  while (startSec < totalDuration) {
    const endSec = Math.min(totalDuration, startSec + safeWindowDuration)
    windows.push({
      index: windows.length,
      startSec,
      endSec,
      durationSec: endSec - startSec
    })

    if (endSec >= totalDuration) {
      break
    }

    startSec += step
  }

  return windows
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

function p2(n: number): string {
  return String(n).padStart(2, '0')
}

function p3(n: number): string {
  return String(n).padStart(3, '0')
}

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
      outputBlocks.push([String(counter++), ...lines.slice(1)].join('\n'))
    }
  }

  return outputBlocks.join('\n\n') + '\n'
}

export function parseSrtContent(srtContent: string): SubtitleCue[] {
  const blocks = srtContent.replace(/\r/g, '').trim().split(/\n\s*\n/)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)

    if (lines.length < 2) continue

    const timestampIndex = lines.findIndex((line) =>
      /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}$/.test(line)
    )
    if (timestampIndex === -1 || timestampIndex === lines.length - 1) continue

    const match = lines[timestampIndex].match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})$/
    )
    if (!match) continue

    const startSec = parseTimestamp(match[1])
    const endSec = parseTimestamp(match[2])
    const text = lines.slice(timestampIndex + 1).join('\n').trim()

    if (!text || endSec <= startSec) continue

    cues.push({ startSec, endSec, text })
  }

  return cues
}

export function findLargeInternalGaps(cues: SubtitleCue[], thresholdSec: number): SubtitleGap[] {
  if (cues.length < 2) return []

  const sortedCues = [...cues].sort(
    (left, right) => left.startSec - right.startSec || left.endSec - right.endSec
  )
  const gaps: SubtitleGap[] = []

  for (let index = 0; index < sortedCues.length - 1; index++) {
    const startSec = sortedCues[index].endSec
    const endSec = sortedCues[index + 1].startSec
    const durationSec = endSec - startSec

    if (durationSec >= thresholdSec) {
      gaps.push({ startSec, endSec, durationSec })
    }
  }

  return gaps
}

export function dedupeSubtitleCues(cues: SubtitleCue[]): SubtitleCue[] {
  const sortedCues = [...cues].sort(
    (left, right) =>
      left.startSec - right.startSec || left.endSec - right.endSec || left.text.localeCompare(right.text)
  )
  const deduped: SubtitleCue[] = []

  for (const cue of sortedCues) {
    const previousCue = deduped[deduped.length - 1]
    if (!previousCue || !areEquivalentCues(previousCue, cue)) {
      deduped.push(cue)
      continue
    }

    deduped[deduped.length - 1] = pickBetterCue(previousCue, cue)
  }

  return deduped
}

export function replaceCueRange(
  cues: SubtitleCue[],
  startSec: number,
  endSec: number,
  replacementCues: SubtitleCue[]
): SubtitleCue[] {
  const preservedCues = cues.filter((cue) => cue.endSec <= startSec || cue.startSec >= endSec)
  return dedupeSubtitleCues([...preservedCues, ...replacementCues])
}

export function serializeSrtCues(cues: SubtitleCue[]): string {
  if (cues.length === 0) return ''

  return (
    cues
      .map(
        (cue, index) =>
          `${index + 1}\n${fromSec(cue.startSec)} --> ${fromSec(cue.endSec)}\n${cue.text}`
      )
      .join('\n\n') + '\n'
  )
}

export function splitSrtByDurations(srtContent: string, partDurations: number[]): string[] {
  if (partDurations.length === 0) return []

  const cues = parseSrtContent(srtContent)
  const normalizedDurations = partDurations.map((duration) => Math.max(0, duration))
  const partStarts: number[] = []
  let cursor = 0

  for (const duration of normalizedDurations) {
    partStarts.push(cursor)
    cursor += duration
  }

  const partCues = normalizedDurations.map<SubtitleCue[]>(() => [])

  for (const cue of cues) {
    for (let index = 0; index < normalizedDurations.length; index++) {
      const partStart = partStarts[index]
      const partEnd = partStart + normalizedDurations[index]
      const overlapStart = Math.max(cue.startSec, partStart)
      const overlapEnd = Math.min(cue.endSec, partEnd)

      if (overlapEnd <= overlapStart) {
        continue
      }

      partCues[index].push({
        startSec: overlapStart - partStart,
        endSec: overlapEnd - partStart,
        text: cue.text
      })
    }
  }

  return partCues.map((cuesForPart) => serializeSrtCues(cuesForPart))
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

function parseTimestamp(timestamp: string): number {
  const match = timestamp.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/)
  if (!match) return 0
  return toSec(match[1], match[2], match[3], match[4])
}

function areEquivalentCues(left: SubtitleCue, right: SubtitleCue): boolean {
  const normalizedLeft = normalizeCueText(left.text)
  const normalizedRight = normalizeCueText(right.text)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  const sameTiming =
    Math.abs(left.startSec - right.startSec) <= 1.5 && Math.abs(left.endSec - right.endSec) <= 1.5
  const sameText =
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)

  return sameTiming && sameText
}

function normalizeCueText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function pickBetterCue(left: SubtitleCue, right: SubtitleCue): SubtitleCue {
  const leftTextLength = normalizeCueText(left.text).length
  const rightTextLength = normalizeCueText(right.text).length
  if (rightTextLength !== leftTextLength) {
    return rightTextLength > leftTextLength ? right : left
  }

  const leftDuration = left.endSec - left.startSec
  const rightDuration = right.endSec - right.startSec
  return rightDuration > leftDuration ? right : left
}
