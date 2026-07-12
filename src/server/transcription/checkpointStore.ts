import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DataPaths } from '../../core/platform/dataPaths'
import type { ArtifactStore } from '../../core/artifacts/artifactStore'
import { readVersionedJson, writeVersionedJson } from '../../core/persistence/atomicJsonStore'

interface SegmentCheckpointData {
  segmentCount: number
  completed: number[]
}

function isCheckpoint(value: unknown): value is SegmentCheckpointData {
  if (!value || typeof value !== 'object') return false
  const checkpoint = value as Partial<SegmentCheckpointData>
  return (
    Number.isInteger(checkpoint.segmentCount) &&
    checkpoint.segmentCount! > 0 &&
    Array.isArray(checkpoint.completed) &&
    checkpoint.completed.every((index) => Number.isInteger(index) && index >= 0)
  )
}

export class ServerCheckpointStore {
  readonly dir: string
  private readonly statePath: string
  private data: SegmentCheckpointData

  constructor(
    paths: DataPaths,
    private readonly artifacts: ArtifactStore,
    private readonly jobId: string,
    segmentCount: number,
    private readonly retentionMs = 30 * 24 * 60 * 60 * 1000
  ) {
    this.dir = join(paths.checkpointsDir, jobId)
    this.statePath = join(this.dir, 'state.json')
    mkdirSync(this.dir, { recursive: true })
    if (existsSync(this.statePath)) {
      const restored = readVersionedJson({
        filePath: this.statePath,
        schemaVersion: 1,
        validate: isCheckpoint,
        migrateLegacy: (value) => {
          if (!isCheckpoint(value)) throw new Error('Invalid transcription checkpoint.')
          return value
        }
      }).data
      this.data =
        restored.segmentCount === segmentCount ? restored : { segmentCount, completed: [] }
    } else {
      this.data = { segmentCount, completed: [] }
    }
    writeVersionedJson(this.statePath, 1, this.data)
    const existing = artifacts.list().find((artifact) => artifact.path === this.dir)
    if (existing) artifacts.addReference(existing.id, `job:${jobId}`)
    else
      artifacts.register({
        category: 'checkpoint',
        path: this.dir,
        expiresAt: Date.now() + this.retentionMs,
        references: [`job:${jobId}`]
      })
  }

  has(index: number): boolean {
    return this.data.completed.includes(index) && existsSync(this.segmentPath(index))
  }

  read(index: number): string {
    return readFileSync(this.segmentPath(index), 'utf-8')
  }

  commit(index: number, srt: string): void {
    const path = this.segmentPath(index)
    const temporary = `${path}.tmp`
    writeFileSync(temporary, srt, 'utf-8')
    renameSync(temporary, path)
    if (!this.data.completed.includes(index)) {
      this.data.completed.push(index)
      this.data.completed.sort((left, right) => left - right)
      writeVersionedJson(this.statePath, 1, this.data)
    }
  }

  complete(): void {
    const artifact = this.artifacts.list().find((entry) => entry.path === this.dir)
    if (!artifact) {
      rmSync(this.dir, { recursive: true, force: true })
      return
    }
    const preview = this.artifacts.previewCleanup({
      artifactIds: [artifact.id],
      releaseReferences: [`job:${this.jobId}`]
    })
    if (preview.artifactCount === 1) this.artifacts.executeCleanup(preview.token)
  }

  private segmentPath(index: number): string {
    return join(this.dir, `segment-${String(index).padStart(5, '0')}.srt`)
  }
}
