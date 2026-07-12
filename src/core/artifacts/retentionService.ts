import type { ManagedArtifactCategory } from './types'
import { ArtifactStore } from './artifactStore'

const RETAINED_CATEGORIES: ManagedArtifactCategory[] = [
  'upload-source',
  'result',
  'checkpoint',
  'temporary',
  'log'
]

export interface RetentionSweepResult {
  deletedIds: string[]
  failedIds: string[]
  skipped: boolean
}

export class RetentionService {
  private interval: ReturnType<typeof setInterval> | null = null
  private sweepActive = false

  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = 6 * 60 * 60 * 1000
  ) {}

  sweep(): RetentionSweepResult {
    if (this.sweepActive) return { deletedIds: [], failedIds: [], skipped: true }
    this.sweepActive = true
    try {
      this.artifacts.reconcileTombstones()
      const preview = this.artifacts.previewCleanup({
        categories: RETAINED_CATEGORIES,
        expiredBefore: this.now()
      })
      if (preview.artifactCount === 0) {
        return { deletedIds: [], failedIds: [], skipped: false }
      }
      return { ...this.artifacts.executeCleanup(preview.token), skipped: false }
    } finally {
      this.sweepActive = false
    }
  }

  start(): RetentionSweepResult {
    const initialResult = this.sweep()
    if (!this.interval) {
      this.interval = setInterval(() => this.sweep(), this.intervalMs)
      this.interval.unref?.()
    }
    return initialResult
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
  }
}
