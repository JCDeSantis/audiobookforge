import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { readVersionedJson, writeVersionedJson } from '../../core/persistence/atomicJsonStore'
import type { DataPaths } from '../../core/platform/dataPaths'
import type {
  ComputeBackend,
  TranscriptionJob,
  WhisperModel,
  WhisperProgressEvent
} from '../../shared/types'

const QUEUE_SCHEMA_VERSION = 1

export type ServerQueueInput = Omit<
  TranscriptionJob,
  | 'id'
  | 'status'
  | 'progress'
  | 'srtPath'
  | 'srtPaths'
  | 'qualityReport'
  | 'error'
  | 'createdAt'
  | 'startedAt'
  | 'completedAt'
>

function isJobArray(value: unknown): value is TranscriptionJob[] {
  return Array.isArray(value)
}

function copyJobs(jobs: TranscriptionJob[]): TranscriptionJob[] {
  return jobs.map((job) => ({
    ...job,
    audioFiles: [...job.audioFiles],
    subtitleFormats: job.subtitleFormats ? [...job.subtitleFormats] : undefined,
    srtPaths: [...job.srtPaths],
    progress: job.progress ? { ...job.progress } : null
  }))
}

export class ServerQueue {
  private jobs: TranscriptionJob[] = []

  constructor(
    private readonly paths: DataPaths,
    private readonly now: () => number = Date.now,
    private readonly onUpdated: (jobs: TranscriptionJob[]) => void = () => undefined
  ) {}

  load(): void {
    if (!existsSync(this.paths.queueFile)) return
    this.jobs = readVersionedJson({
      filePath: this.paths.queueFile,
      schemaVersion: QUEUE_SCHEMA_VERSION,
      validate: isJobArray,
      migrateLegacy: (legacy) => {
        if (!Array.isArray(legacy)) throw new Error('Legacy queue must be an array.')
        return legacy as TranscriptionJob[]
      }
    }).data
    let changed = false
    for (const job of this.jobs) {
      if (job.status === 'running') {
        job.status = 'paused'
        job.startedAt = null
        changed = true
      }
    }
    if (changed) this.commit()
  }

  list(): TranscriptionJob[] {
    return copyJobs(this.jobs)
  }

  get(jobId: string): TranscriptionJob {
    return copyJobs([this.requireJob(jobId)])[0]
  }

  claimNext(): TranscriptionJob | null {
    if (this.jobs.some((job) => job.status === 'running')) return null
    const job = this.jobs.find((entry) => entry.status === 'queued')
    if (!job) return null
    job.status = 'running'
    job.startedAt = this.now()
    job.completedAt = null
    job.error = null
    job.progress = { jobId: job.id, phase: 'preparing', percent: 0 }
    this.commit()
    return copyJobs([job])[0]
  }

  updateProgress(jobId: string, progress: Omit<WhisperProgressEvent, 'jobId'>): void {
    const job = this.requireJob(jobId)
    if (job.status !== 'running') return
    job.progress = { ...progress, jobId }
    this.commit()
  }

  complete(
    jobId: string,
    resultArtifactIds: string[],
    backend: ComputeBackend,
    fallbackReason: string | null,
    deliveryWarning: string | null = null
  ): void {
    const job = this.requireJob(jobId)
    if (job.status !== 'running') return
    job.status = 'done'
    job.progress = { jobId, phase: 'done', percent: 100 }
    job.resultArtifactIds = [...resultArtifactIds]
    job.computeBackend = backend
    job.computeFallbackReason = fallbackReason
    job.deliveryWarning = deliveryWarning
    job.completedAt = this.now()
    this.commit()
  }

  fail(jobId: string, error: string): void {
    const job = this.requireJob(jobId)
    if (job.status !== 'running') return
    job.status = 'failed'
    job.progress = { jobId, phase: 'error', percent: 0, error }
    job.error = error.slice(0, 2000)
    job.completedAt = this.now()
    this.commit()
  }

  add(input: ServerQueueInput): TranscriptionJob {
    if (input.source !== 'upload' && input.source !== 'abs') {
      throw new Error('Web jobs must use an uploaded or Audiobookshelf source.')
    }
    if (!input.title?.trim() || !input.model) throw new Error('Job title and model are required.')
    if (input.source === 'upload' && !input.uploadSessionId) {
      throw new Error('Uploaded jobs require a finalized upload session.')
    }
    const timestamp = this.now()
    const job: TranscriptionJob = {
      ...input,
      title: input.title.trim().slice(0, 300),
      id: randomUUID(),
      status: 'queued',
      progress: null,
      srtPath: null,
      srtPaths: [],
      qualityReport: null,
      error: null,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null
    }
    this.jobs.push(job)
    this.commit()
    return copyJobs([job])[0]
  }

  remove(jobId: string): TranscriptionJob {
    const job = this.requireJob(jobId)
    if (job.status === 'running') throw new Error('Running jobs must be cancelled first.')
    this.jobs = this.jobs.filter((entry) => entry.id !== jobId)
    this.commit()
    return copyJobs([job])[0]
  }

  reorder(orderedIds: string[]): void {
    const movable = this.jobs.filter((job) => job.status === 'queued' || job.status === 'paused')
    if (
      orderedIds.length !== movable.length ||
      new Set(orderedIds).size !== movable.length ||
      movable.some((job) => !orderedIds.includes(job.id))
    ) {
      throw new Error('Queue order must contain every queued and paused job exactly once.')
    }
    const ordered = orderedIds.map((id) => this.requireJob(id))
    const fixed = this.jobs.filter((job) => job.status !== 'queued' && job.status !== 'paused')
    this.jobs = [...ordered, ...fixed]
    this.commit()
  }

  cancel(jobId: string): void {
    const job = this.requireJob(jobId)
    if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'paused') return
    job.status = 'cancelled'
    job.completedAt = this.now()
    this.commit()
  }

  pause(jobId: string): void {
    const job = this.requireJob(jobId)
    if (job.status !== 'running') throw new Error('Only running jobs can be paused.')
    job.status = 'paused'
    job.startedAt = null
    this.commit()
  }

  resume(jobId: string): void {
    const job = this.requireJob(jobId)
    if (job.status !== 'paused') throw new Error('Only paused jobs can be resumed.')
    job.status = 'queued'
    job.completedAt = null
    this.commit()
  }

  retry(jobId: string, model?: WhisperModel): TranscriptionJob {
    const original = this.requireJob(jobId)
    if (original.status !== 'failed' && original.status !== 'cancelled') {
      throw new Error('Only failed or cancelled jobs can be retried.')
    }
    return this.add({
      source: original.source,
      title: original.title,
      audioFiles: [...original.audioFiles],
      outputPath: original.outputPath,
      absItemId: original.absItemId,
      absLibraryId: original.absLibraryId,
      absFolderId: original.absFolderId,
      absAuthorName: original.absAuthorName,
      epubPath: original.epubPath,
      model: model ?? original.model,
      subtitleFormats: original.subtitleFormats,
      uploadSessionId: original.uploadSessionId
    })
  }

  clearFinished(): TranscriptionJob[] {
    const removed = this.jobs.filter(
      (job) => job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'
    )
    this.jobs = this.jobs.filter(
      (job) => job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled'
    )
    this.commit()
    return copyJobs(removed)
  }

  private requireJob(jobId: string): TranscriptionJob {
    const job = this.jobs.find((entry) => entry.id === jobId)
    if (!job) throw new Error('Queue job was not found.')
    return job
  }

  private commit(): void {
    writeVersionedJson(this.paths.queueFile, QUEUE_SCHEMA_VERSION, this.jobs)
    this.onUpdated(this.list())
  }
}
