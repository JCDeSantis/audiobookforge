import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ArtifactStore, classifyLegacyManagedPath } from '../artifactStore'
import { createDataPaths } from '../../platform/dataPaths'

let root = ''

describe('managed artifact ownership', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-artifacts-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses to manage or delete a Windows-style external output location', () => {
    const paths = createDataPaths(root)
    const store = new ArtifactStore(paths)
    const externalPath = join(root, '..', 'user-selected-output', 'book.srt')

    expect(() => store.register({ category: 'result', path: externalPath })).toThrow(
      'Managed artifacts must be inside application storage.'
    )
  })

  it('classifies only known legacy application paths as managed', () => {
    const paths = createDataPaths(root)

    expect(classifyLegacyManagedPath(paths, join(root, 'srt', 'fallback.srt'))).toBe('result')
    expect(classifyLegacyManagedPath(paths, join(root, 'checkpoints', 'job-1', '1.srt'))).toBe(
      'checkpoint'
    )
    expect(classifyLegacyManagedPath(paths, join(root, '..', 'external', 'book.srt'))).toBeNull()
  })

  it('excludes leased and independently referenced artifacts from cleanup previews', () => {
    const paths = createDataPaths(root)
    const store = new ArtifactStore(paths, () => 1000)
    mkdirSync(paths.resultsDir, { recursive: true })
    const firstPath = join(paths.resultsDir, 'first.srt')
    const secondPath = join(paths.resultsDir, 'second.srt')
    writeFileSync(firstPath, 'first', 'utf-8')
    writeFileSync(secondPath, 'second', 'utf-8')
    store.register({ id: 'first', category: 'result', path: firstPath, references: ['job-1'] })
    store.register({ id: 'second', category: 'result', path: secondPath, references: ['job-2'] })
    store.acquireLease('second', 'download-1')

    const preview = store.previewCleanup({
      categories: ['result'],
      releaseReferences: ['job-1', 'job-2']
    })

    expect(preview.artifactIds).toEqual(['first'])
  })

  it('rejects stale cleanup previews before touching files', () => {
    const paths = createDataPaths(root)
    const store = new ArtifactStore(paths)
    mkdirSync(paths.tempDir, { recursive: true })
    const tempPath = join(paths.tempDir, 'work.wav')
    writeFileSync(tempPath, 'temporary', 'utf-8')
    store.register({ id: 'temp', category: 'temporary', path: tempPath })
    const preview = store.previewCleanup({ artifactIds: ['temp'] })
    store.addReference('temp', 'job-1')

    expect(() => store.executeCleanup(preview.token)).toThrow(
      'Cleanup preview is missing or expired.'
    )
    expect(existsSync(tempPath)).toBe(true)
  })

  it('tombstones and removes managed data after a confirmed preview', () => {
    const paths = createDataPaths(root)
    const store = new ArtifactStore(paths)
    mkdirSync(paths.uploadsDir, { recursive: true })
    const uploadPath = join(paths.uploadsDir, 'audio.m4b')
    writeFileSync(uploadPath, 'audio', 'utf-8')
    store.register({
      id: 'upload',
      category: 'upload-source',
      path: uploadPath,
      references: ['job-1']
    })

    const preview = store.previewCleanup({
      artifactIds: ['upload'],
      releaseReferences: ['job-1']
    })
    const result = store.executeCleanup(preview.token)

    expect(result).toEqual({ deletedIds: ['upload'], failedIds: [] })
    expect(existsSync(uploadPath)).toBe(false)
    expect(store.list()).toEqual([])
  })
})
