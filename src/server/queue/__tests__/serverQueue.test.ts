import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { writeVersionedJson } from '../../../core/persistence/atomicJsonStore'
import { ServerQueue } from '../serverQueue'

let root = ''

describe('server queue', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-server-queue-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('persists finalized upload references without exposing server paths', () => {
    const paths = createDataPaths(root)
    const queue = new ServerQueue(paths, () => 100)
    const job = queue.add({
      source: 'upload',
      title: 'Uploaded Book',
      audioFiles: ['book.m4b'],
      outputPath: null,
      absItemId: null,
      absLibraryId: null,
      absFolderId: null,
      absAuthorName: null,
      epubPath: null,
      model: 'base',
      subtitleFormats: ['srt'],
      uploadSessionId: 'session-1'
    })

    const restored = new ServerQueue(paths)
    restored.load()
    expect(restored.list()).toEqual([job])
    expect(JSON.stringify(job)).not.toContain(root)
  })

  it('recovers interrupted running jobs as paused', () => {
    const paths = createDataPaths(root)
    const queue = new ServerQueue(paths)
    const job = queue.add({
      source: 'upload',
      title: 'Book',
      audioFiles: ['book.m4b'],
      outputPath: null,
      absItemId: null,
      absLibraryId: null,
      absFolderId: null,
      absAuthorName: null,
      epubPath: null,
      model: 'base',
      subtitleFormats: ['srt'],
      uploadSessionId: 'session-1'
    })
    writeVersionedJson(paths.queueFile, 1, [
      { ...queue.list()[0], status: 'running', startedAt: 200 }
    ])
    const pathsQueue = new ServerQueue(paths)
    pathsQueue.load()
    expect(pathsQueue.list()[0]).toMatchObject({ id: job.id, status: 'paused', startedAt: null })
  })

  it('persists worker progress and completion metadata', () => {
    const paths = createDataPaths(root)
    const queue = new ServerQueue(paths, () => 500)
    const job = queue.add({
      source: 'upload',
      title: 'Book',
      audioFiles: ['book.m4b'],
      outputPath: null,
      absItemId: null,
      absLibraryId: null,
      absFolderId: null,
      absAuthorName: null,
      epubPath: null,
      model: 'base',
      subtitleFormats: ['srt'],
      uploadSessionId: 'session-1'
    })

    expect(queue.claimNext()).toMatchObject({ id: job.id, status: 'running', startedAt: 500 })
    queue.updateProgress(job.id, { phase: 'transcribing', percent: 42 })
    queue.complete(job.id, ['artifact-1'], 'cuda', 'out-of-memory')

    const restored = new ServerQueue(paths)
    restored.load()
    expect(restored.get(job.id)).toMatchObject({
      status: 'done',
      resultArtifactIds: ['artifact-1'],
      computeBackend: 'cuda',
      computeFallbackReason: 'out-of-memory',
      progress: { phase: 'done', percent: 100 }
    })
  })
})
