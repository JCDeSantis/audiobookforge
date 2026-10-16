import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'module'

const electronState = vi.hoisted(() => ({ isPackaged: false }))

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return electronState.isPackaged
    }
  }
}))

import { getFfmpegPath, getFfprobePath, probeFile } from '../probe'

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'abf-probe-runtime-'))
  electronState.isPackaged = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  electronState.isPackaged = false
  rmSync(root, { recursive: true, force: true })
})

describe('packaged ffprobe discovery', () => {
  it('uses the unpacked dependency path for a packaged Electron archive', async () => {
    const require = createRequire(import.meta.url)
    const dependency = require('ffprobe-static') as { path: string }
    const originalPath = dependency.path
    electronState.isPackaged = true
    vi.stubGlobal('process', { ...process, platform: 'win32', resourcesPath: root })
    dependency.path = join(root, 'app.asar', 'node_modules', 'ffprobe.exe')
    vi.resetModules()
    try {
      const runtimeProbe = await import('../probe')
      expect(runtimeProbe.getFfprobePath()).toBe(
        join(root, 'app.asar.unpacked', 'node_modules', 'ffprobe.exe')
      )
    } finally {
      dependency.path = originalPath
      vi.resetModules()
    }
  })

  it('uses the platform dependency for packaged Windows even if a Mac resource exists', () => {
    const developmentPath = getFfprobePath()
    const macResource = join(root, 'ffmpeg', 'ffprobe')
    mkdirSync(join(root, 'ffmpeg'))
    writeFileSync(macResource, '')
    electronState.isPackaged = true
    vi.stubGlobal('process', { ...process, platform: 'win32', resourcesPath: root })

    expect(getFfprobePath()).toBe(developmentPath)
    expect(getFfprobePath()).not.toBe(macResource)
  })

  it('prefers the bundled Mac ffprobe when present', () => {
    const bundled = join(root, 'ffmpeg', 'ffprobe')
    mkdirSync(join(root, 'ffmpeg'))
    writeFileSync(bundled, '')
    electronState.isPackaged = true
    vi.stubGlobal('process', { ...process, platform: 'darwin', resourcesPath: root })

    expect(getFfprobePath()).toBe(bundled)
  })

  it('falls back to the platform dependency when the Mac resource is absent', () => {
    const developmentPath = getFfprobePath()
    electronState.isPackaged = true
    vi.stubGlobal('process', { ...process, platform: 'darwin', resourcesPath: root })

    expect(getFfprobePath()).toBe(developmentPath)
  })
})

describe('real media chapter extraction', () => {
  // This exercises the Windows dependency and archive fallback. Mac packaging is
  // exercised separately with the genuinely arm64 ffprobe built from source.
  it.skipIf(process.platform !== 'win32' || !existsSync(getFfmpegPath())).each([false, true])(
    'reads both M4B chapters with isPackaged=%s',
    async (isPackaged) => {
      const metadataPath = join(root, 'chapters.txt')
      const audioPath = join(root, 'chapters.m4b')
      writeFileSync(
        metadataPath,
        ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=One\n' +
          '[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Two\n'
      )
      execFileSync(
        getFfmpegPath(),
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=2',
          '-i',
          metadataPath,
          '-map_metadata',
          '1',
          '-map_chapters',
          '1',
          '-c:a',
          'aac',
          audioPath
        ],
        { stdio: 'pipe' }
      )
      electronState.isPackaged = isPackaged
      vi.stubGlobal('process', { ...process, platform: 'win32', resourcesPath: root })

      const result = await probeFile(audioPath)

      expect(result.chapters).toEqual([
        { startSec: 0, endSec: 1, title: 'One' },
        { startSec: 1, endSec: 2, title: 'Two' }
      ])
    }
  )
})
