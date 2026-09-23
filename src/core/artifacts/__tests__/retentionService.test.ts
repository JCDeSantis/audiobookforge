import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ArtifactStore } from '../artifactStore'
import { RetentionService } from '../retentionService'
import { createDataPaths } from '../../platform/dataPaths'

let root = ''

describe('artifact retention', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-retention-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('deletes expired unreferenced artifacts but preserves future and leased data', () => {
    const paths = createDataPaths(root)
    const store = new ArtifactStore(paths, () => 100)
    mkdirSync(paths.uploadsDir, { recursive: true })
    const expiredPath = join(paths.uploadsDir, 'expired.m4b')
    const futurePath = join(paths.uploadsDir, 'future.m4b')
    const leasedPath = join(paths.uploadsDir, 'leased.m4b')
    for (const path of [expiredPath, futurePath, leasedPath]) writeFileSync(path, 'audio')
    store.register({ id: 'expired', category: 'upload-source', path: expiredPath, expiresAt: 50 })
    store.register({ id: 'future', category: 'upload-source', path: futurePath, expiresAt: 200 })
    store.register({ id: 'leased', category: 'upload-source', path: leasedPath, expiresAt: 50 })
    store.acquireLease('leased', 'job-running')

    const result = new RetentionService(store, () => 100).sweep()

    expect(result).toEqual({ deletedIds: ['expired'], failedIds: [], skipped: false })
    expect(existsSync(expiredPath)).toBe(false)
    expect(existsSync(futurePath)).toBe(true)
    expect(existsSync(leasedPath)).toBe(true)
  })

  it('preserves expired artifacts that are still referenced by a job', () => {
    const paths = createDataPaths(root)
    const store = new ArtifactStore(paths, () => 100)
    mkdirSync(paths.resultsDir, { recursive: true })
    const resultPath = join(paths.resultsDir, 'book.srt')
    writeFileSync(resultPath, 'subtitle')
    store.register({
      id: 'result',
      category: 'result',
      path: resultPath,
      expiresAt: 50,
      references: ['job-1']
    })

    expect(new RetentionService(store, () => 100).sweep().deletedIds).toEqual([])
    expect(existsSync(resultPath)).toBe(true)
  })
})
