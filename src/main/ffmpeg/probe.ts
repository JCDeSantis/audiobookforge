import { execFile } from 'child_process'
import { promisify } from 'util'
import { sep } from 'path'
import { parseFile as mmParseFile } from 'music-metadata'
import type { ProbeChapter, ProbeResult } from '../../shared/types'

let nvencCache: boolean | null = null

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic = require('ffmpeg-static') as string

const execFileAsync = promisify(execFile)

// When packaged, asarUnpack copies binaries to app.asar.unpacked — fix the path.
function unpackedPath(p: string): string {
  return p.replace('app.asar' + sep, 'app.asar.unpacked' + sep)
}

export function getFfmpegPath(): string {
  return unpackedPath(ffmpegStatic)
}

// Returns true if the bundled ffmpeg binary supports h264_nvenc (NVIDIA GPU encoding).
// Result is cached for the lifetime of the process.
export async function detectNvenc(): Promise<boolean> {
  if (nvencCache !== null) return nvencCache
  try {
    const { stdout } = await execFileAsync(getFfmpegPath(), ['-hide_banner', '-encoders'])
    nvencCache = stdout.includes('h264_nvenc')
  } catch {
    nvencCache = false
  }
  return nvencCache
}

export async function probeFile(filePath: string): Promise<ProbeResult> {
  const meta = await mmParseFile(filePath, { duration: true, includeChapters: true, skipCovers: false })

  const duration = meta.format.duration ?? 0
  if (!Number.isFinite(duration)) {
    throw new Error(`Could not read duration for ${filePath}`)
  }

  const hasCoverArt = Array.isArray(meta.common.picture) && meta.common.picture.length > 0

  const tags: Record<string, string> = {}
  if (meta.common.title) tags['title'] = meta.common.title
  if (meta.common.artist) tags['artist'] = meta.common.artist
  if (meta.common.album) tags['album'] = meta.common.album

  const rawChapters = meta.format.chapters ?? []
  const parsedChapters: ProbeChapter[] = rawChapters
    .map((chapter, index) => ({
      startSec: chapter.start,
      endSec: chapter.end ?? rawChapters[index + 1]?.start ?? duration,
      title: chapter.title?.trim() || null
    }))
    .filter((chapter) => Number.isFinite(chapter.startSec) && Number.isFinite(chapter.endSec))
    .filter((chapter) => chapter.endSec > chapter.startSec)

  return {
    duration,
    format: meta.format.container ?? 'unknown',
    tags,
    hasCoverArt,
    chapters: parsedChapters
  }
}

export async function sumDurations(filePaths: string[]): Promise<number> {
  const results = await Promise.all(filePaths.map(probeFile))
  return results.reduce((sum, r) => sum + r.duration, 0)
}
