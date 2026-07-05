import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createDataPaths } from '../../../core/platform/dataPaths'
import type { UploadStore } from '../../uploads/uploadStore'
import type { ServerTranscriptionResult } from '../../transcription/serverTranscriber'
import { ServerQueue } from '../serverQueue'
import { ServerQueueWorker } from '../serverQueueWorker'

let root = ''

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for worker state.')
}

describe('server queue worker', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-server-worker-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('runs one finalized upload and records its managed results', async () => {
    const queue = new ServerQueue(createDataPaths(root))
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
      subtitleFormats: ['srt', 'vtt'],
      uploadSessionId: 'session-1'
    })
    const uploads = {
      getFinalizedInputs: vi.fn(() => ({ audioPaths: ['managed-book.data'], epubPath: null })),
      releaseFromJob: vi.fn()
    } as unknown as UploadStore
    const result: ServerTranscriptionResult = {
      resultArtifactIds: ['srt-artifact', 'vtt-artifact'],
      backend: 'cpu',
      fallbackReason: null
    }
    const transcriber = {
      transcribe: vi.fn(async (...args: unknown[]) => {
        const onProgress = args[5] as (progress: { phase: 'transcribing'; percent: number }) => void
        onProgress({ phase: 'transcribing', percent: 60 })
        return result
      })
    }
    const worker = new ServerQueueWorker(queue, uploads, transcriber)

    worker.start()
    await waitFor(() => queue.get(job.id).status === 'done')
    worker.stop()

    expect(transcriber.transcribe).toHaveBeenCalledTimes(1)
    expect(queue.get(job.id)).toMatchObject({
      status: 'done',
      resultArtifactIds: result.resultArtifactIds,
      computeBackend: 'cpu'
    })
  })
})
