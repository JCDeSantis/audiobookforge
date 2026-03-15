import { execFile } from 'child_process'
import { promisify } from 'util'
import { sep } from 'path'
import type { ProbeResult } from '../../shared/types'

let nvencCache: boolean | null = null

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic = require('ffmpeg-static') as string
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic = (require('ffprobe-static') as { path: string }).path

const execFileAsync = promisify(execFile)

// When packaged, asarUnpack copies binaries to app.asar.unpacked — fix the path.
function unpackedPath(p: string): string {
  return p.replace('app.asar' + sep, 'app.asar.unpacked' + sep)
}

export function getFfmpegPath(): string {
  return unpackedPath(ffmpegStatic)
}

export function getFfprobePath(): string {
  return unpackedPath(ffprobeStatic)
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
  const ffprobe = getFfprobePath()
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ])

  const data = JSON.parse(stdout)
  const format = data.format ?? {}
  const streams: Array<{ codec_type: string; codec_name: string }> = data.streams ?? []

  const hasCoverArt = streams.some(
    (s) => s.codec_type === 'video' && ['mjpeg', 'png', 'bmp'].includes(s.codec_name)
  )

  return {
    duration: parseFloat(format.duration ?? '0'),
    format: format.format_name ?? 'unknown',
    tags: format.tags ?? {},
    hasCoverArt
  }
}

export async function sumDurations(filePaths: string[]): Promise<number> {
  const results = await Promise.all(filePaths.map(probeFile))
  return results.reduce((sum, r) => sum + r.duration, 0)
}
