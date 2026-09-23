import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { ServerInstanceLock } from '../instanceLock'
import { scavengeInterruptedProcessing } from '../startupRecovery'

let root = ''

describe('server startup recovery', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-recovery-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('holds an exclusive data-directory lock and releases it cleanly', () => {
    const paths = createDataPaths(root)
    const first = new ServerInstanceLock(paths)
    const second = new ServerInstanceLock(paths)
    first.acquire()
    expect(() => second.acquire()).toThrow('already using this data directory')
    first.release()
    expect(() => second.acquire()).not.toThrow()
    second.release()
  })

  it('removes interrupted processing data without touching uploads or results', () => {
    const paths = createDataPaths(root)
    mkdirSync(join(paths.tempDir, 'job-1'), { recursive: true })
    mkdirSync(paths.uploadsDir, { recursive: true })
    mkdirSync(paths.resultsDir, { recursive: true })
    writeFileSync(join(paths.tempDir, 'job-1', 'audio.wav'), 'partial')
    writeFileSync(join(paths.uploadsDir, 'source.data'), 'source')
    writeFileSync(join(paths.resultsDir, 'result.srt'), 'result')

    scavengeInterruptedProcessing(paths)

    expect(existsSync(join(paths.tempDir, 'job-1'))).toBe(false)
    expect(existsSync(join(paths.uploadsDir, 'source.data'))).toBe(true)
    expect(existsSync(join(paths.resultsDir, 'result.srt'))).toBe(true)
  })
})
