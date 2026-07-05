import type { SubtitleFormat, TranscriptionJob, WhisperProgressEvent } from '../../shared/types'
import type { UploadStore } from '../uploads/uploadStore'
import type { ServerTranscriptionResult } from '../transcription/serverTranscriber'
import type { ServerQueue } from './serverQueue'

interface TranscriberLike {
  transcribe(
    jobId: string,
    title: string,
    audioPaths: string[],
    model: TranscriptionJob['model'],
    formats: SubtitleFormat[],
    onProgress: (progress: Omit<WhisperProgressEvent, 'jobId'>) => void,
    signal: AbortSignal
  ): Promise<ServerTranscriptionResult>
}

export class ServerQueueWorker {
  private running = false
  private stopped = false
  private active: { jobId: string; controller: AbortController } | null = null

  constructor(
    private readonly queue: ServerQueue,
    private readonly uploads: UploadStore,
    private readonly transcriber: TranscriberLike
  ) {}

  start(): void {
    this.stopped = false
    this.kick()
  }

  kick(): void {
    if (this.running || this.stopped) return
    this.running = true
    void this.run().finally(() => {
      this.running = false
      if (!this.stopped && this.queue.list().some((job) => job.status === 'queued')) this.kick()
    })
  }

  interrupt(jobId: string): void {
    if (this.active?.jobId === jobId) this.active.controller.abort()
  }

  stop(): void {
    this.stopped = true
    this.active?.controller.abort()
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const job = this.queue.claimNext()
      if (!job) return
      const controller = new AbortController()
      this.active = { jobId: job.id, controller }
      try {
        if (job.source !== 'upload' || !job.uploadSessionId) {
          throw new Error('This server worker currently requires a finalized browser upload.')
        }
        const inputs = this.uploads.getFinalizedInputs(job.uploadSessionId)
        const result = await this.transcriber.transcribe(
          job.id,
          job.title,
          inputs.audioPaths,
          job.model,
          job.subtitleFormats ?? ['srt'],
          (progress) => this.queue.updateProgress(job.id, progress),
          controller.signal
        )
        this.queue.complete(job.id, result.resultArtifactIds, result.backend, result.fallbackReason)
      } catch (error) {
        const current = this.queue.get(job.id)
        if (current.status === 'running') {
          this.queue.fail(job.id, error instanceof Error ? error.message : 'Transcription failed.')
        }
      } finally {
        const finished = this.queue.get(job.id)
        if (
          finished.uploadSessionId &&
          (finished.status === 'done' || finished.status === 'failed' || finished.status === 'cancelled')
        ) {
          this.uploads.releaseFromJob(finished.uploadSessionId, finished.id)
        }
        if (this.active?.jobId === job.id) this.active = null
      }
    }
  }
}
