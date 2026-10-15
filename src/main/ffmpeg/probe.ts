import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, sep } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { parseFile as mmParseFile } from 'music-metadata'
import type { ProbeChapter, ProbeResult } from '../../shared/types'

let nvencCache: boolean | null = null

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic = require('ffmpeg-static') as string
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStaticPath = require('ffprobe-static') as string | null

const execFileAsync = promisify(execFile)

// When packaged, asarUnpack copies binaries to app.asar.unpacked — fix the path.
function unpackedPath(p: string): string {
  return p.replace('app.asar' + sep, 'app.asar.unpacked' + sep)
}

export function getFfmpegPath(): string {
  return unpackedPath(ffmpegStatic)
}

function getFfprobePath(): string | null {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'ffmpeg', 'ffprobe')
    return existsSync(bundled) ? bundled : null
  }
  return typeof ffprobeStaticPath === 'string' ? ffprobeStaticPath : null
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

interface FfprobeChapter {
  start_time?: string
  end_time?: string
  tags?: { title?: string }
}

// Exported so tests can exercise chapter parsing logic directly without spawning ffprobe.
export function parseChaptersFromFfprobeOutput(stdout: string, duration: number): ProbeChapter[] {
  let data: { chapters?: FfprobeChapter[] }
  try {
    data = JSON.parse(stdout) as { chapters?: FfprobeChapter[] }
  } catch {
    return []
  }
  const raw = data.chapters ?? []
  return raw
    .map((ch, index) => {
      const startSec = parseFloat(ch.start_time ?? '')
      const rawEnd = parseFloat(ch.end_time ?? '')
      const nextStart = parseFloat(raw[index + 1]?.start_time ?? '')
      const endSec = Number.isFinite(rawEnd) ? rawEnd
        : Number.isFinite(nextStart) ? nextStart
        : duration
      return { startSec, endSec, title: ch.tags?.title?.trim() || null }
    })
    .filter((ch) => Number.isFinite(ch.startSec) && Number.isFinite(ch.endSec))
    .filter((ch) => ch.endSec > ch.startSec)
}

// music-metadata cannot reliably parse chapters from normal-layout M4B (moov-last) files
// because its tokenizer is forward-only and the chapter text sits in mdat before moov.
// ffprobe handles both layouts and returns start_time/end_time already in seconds.
async function extractChapters(filePath: string, duration: number): Promise<ProbeChapter[]> {
  const ffprobePath = getFfprobePath()
  if (!ffprobePath || !existsSync(ffprobePath)) return []
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_chapters',
      filePath
    ])
    return parseChaptersFromFfprobeOutput(stdout, duration)
  } catch {
    return []
  }
}

export async function probeFile(filePath: string): Promise<ProbeResult> {
  const meta = await mmParseFile(filePath, { duration: true, skipCovers: false })

  const duration = meta.format.duration ?? 0
  if (!Number.isFinite(duration)) {
    throw new Error(`Could not read duration for ${filePath}`)
  }

  const chapters = await extractChapters(filePath, duration)

  const hasCoverArt = Array.isArray(meta.common.picture) && meta.common.picture.length > 0

  const tags: Record<string, string> = {}
  if (meta.common.title) tags['title'] = meta.common.title
  if (meta.common.artist) tags['artist'] = meta.common.artist
  if (meta.common.album) tags['album'] = meta.common.album

  return {
    duration,
    format: meta.format.container ?? 'unknown',
    tags,
    hasCoverArt,
    chapters
  }
}

export async function sumDurations(filePaths: string[]): Promise<number> {
  const results = await Promise.all(filePaths.map(probeFile))
  return results.reduce((sum, r) => sum + r.duration, 0)
}
