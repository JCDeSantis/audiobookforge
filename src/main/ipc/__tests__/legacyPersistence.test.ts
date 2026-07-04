import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

const electronState = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataPath
  },
  ipcMain: { handle: vi.fn() }
}))

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn(),
    getPassword: vi.fn(),
    deletePassword: vi.fn()
  }
}))

import { loadQueue, persistQueue } from '../queue.ipc'
import { loadSettings } from '../settings.ipc'
import { PersistenceError } from '../../../core/persistence/atomicJsonStore'

const fixturesDir = resolve('src/main/ipc/__tests__/fixtures')
let userDataPath = ''

describe('v1.1 persistence baseline', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'audiobook-forge-v1.1-'))
    electronState.userDataPath = userDataPath
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('loads legacy settings without losing the saved ABS profile or model', () => {
    copyFileSync(join(fixturesDir, 'v1.1-settings.json'), join(userDataPath, 'settings.json'))

    expect(loadSettings()).toEqual({
      absUrl: 'https://abs.example.com',
      absUsername: 'jacob',
      defaultModel: 'large-v3-turbo-q5_0'
    })
  })

  it('hydrates legacy local and ABS queue records with their output references intact', () => {
    copyFileSync(join(fixturesDir, 'v1.1-queue.json'), join(userDataPath, 'queue.json'))

    const jobs = loadQueue()

    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      id: 'legacy-local-done',
      status: 'done',
      source: 'local',
      outputPath: 'C:\\Subtitles',
      srtPaths: ['C:\\Subtitles\\Legacy Book.srt', 'C:\\Subtitles\\Legacy Book.vtt']
    })
    expect(jobs[1]).toMatchObject({
      id: 'legacy-abs-paused',
      status: 'paused',
      source: 'abs',
      absItemId: 'item-1'
    })
  })

  it('persists the current queue format as readable JSON', () => {
    copyFileSync(join(fixturesDir, 'v1.1-queue.json'), join(userDataPath, 'queue.json'))
    const jobs = loadQueue()

    persistQueue(jobs)

    expect(JSON.parse(readFileSync(join(userDataPath, 'queue.json'), 'utf-8'))).toEqual({
      schemaVersion: 1,
      data: jobs
    })
  })

  it('uses safe defaults when no settings file exists', () => {
    expect(loadSettings()).toEqual({
      absUrl: '',
      absUsername: '',
      defaultModel: 'large-v3-turbo-q5_0'
    })
  })

  it('preserves and reports an invalid legacy queue document', () => {
    writeFileSync(join(userDataPath, 'queue.json'), '{"jobs":[]}', 'utf-8')

    expect(() => loadQueue()).toThrow(PersistenceError)
    expect(readFileSync(join(userDataPath, 'queue.json'), 'utf-8')).toBe('{"jobs":[]}')
  })
})
