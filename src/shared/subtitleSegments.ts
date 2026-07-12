function toSeconds(hours: string, minutes: string, seconds: string, millis: string): number {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000
}

function timestamp(seconds: number): string {
  const totalMillis = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMillis / 3_600_000)
  const minutes = Math.floor((totalMillis % 3_600_000) / 60_000)
  const secs = Math.floor((totalMillis % 60_000) / 1000)
  const millis = totalMillis % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function offsetSrtContent(srt: string, offsetSeconds: number): string {
  if (offsetSeconds === 0) return srt
  return srt.replace(
    /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/g,
    (_match, h1, m1, s1, ms1, h2, m2, s2, ms2) =>
      `${timestamp(toSeconds(h1, m1, s1, ms1) + offsetSeconds)} --> ${timestamp(toSeconds(h2, m2, s2, ms2) + offsetSeconds)}`
  )
}

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

  return outputBlocks.length > 0 ? `${outputBlocks.join('\n\n')}\n` : ''
}
