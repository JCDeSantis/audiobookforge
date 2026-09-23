import { join } from 'path'
import { rmSync } from 'fs'
import type { DataPaths } from '../../core/platform/dataPaths'
import type { TranscriptionJob, WhisperProgressEvent } from '../../shared/types'
import { ServerAbsClient } from './absClient'
import { ServerAbsSessionStore } from './sessionStore'
import type { ArtifactStore } from '../../core/artifacts/artifactStore'
import type { ServerTranscriptionResult } from '../transcription/serverTranscriber'

export class ServerAbsJobAdapter {
  constructor(
    private readonly paths: DataPaths,
    private readonly sessions: ServerAbsSessionStore,
    private readonly client: ServerAbsClient,
    private readonly artifacts: ArtifactStore
  ) {}

  async prepare(
    job: TranscriptionJob,
    onProgress: (progress: Omit<WhisperProgressEvent, 'jobId'>) => void,
    signal: AbortSignal
  ): Promise<{ audioPaths: string[]; epubPath: string | null }> {
    if (!job.absItemId) throw new Error('The ABS queue item is missing its item ID.')
    const session = this.sessions.load()
    if (!session) throw new Error('Sign in to Audiobookshelf before running this job.')
    const result = await this.client.downloadBookInputs(
      session,
      job.absItemId,
      join(this.paths.tempDir, job.id),
      (percent) => onProgress({ phase: 'preparing', percent, liveText: 'Downloading from ABS' }),
      signal
    )
    return { audioPaths: result.audioPaths, epubPath: result.epubPath }
  }

  async complete(
    job: TranscriptionJob,
    result: ServerTranscriptionResult,
    signal: AbortSignal
  ): Promise<void> {
    if (!job.absItemId) throw new Error('The ABS queue item is missing its item ID.')
    const session = this.sessions.load()
    if (!session) throw new Error('The ABS session expired before subtitle upload.')
    const book = await this.client.book(session, job.absItemId)
    const paths = result.resultArtifactIds.map((id) => {
      const artifact = this.artifacts.get(id)
      if (!artifact || artifact.category !== 'result') throw new Error('A subtitle result is unavailable.')
      return artifact.path
    })
    await this.client.uploadSubtitleResults(session, book, paths, signal)
  }

  cleanup(job: TranscriptionJob): void {
    rmSync(join(this.paths.tempDir, job.id), { recursive: true, force: true })
  }
}
