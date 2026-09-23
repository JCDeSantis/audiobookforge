import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from 'fs'
import { join } from 'path'
import type { WhisperModel } from '../../shared/types'
import {
  getWhisperModelUrl,
  isSupportedWhisperModel,
  WHISPER_MODELS
} from '../../shared/whisperModels'
import { isWhisperModelSizeAcceptable } from '../../shared/whisperModelValidation'
import type { DataPaths } from '../../core/platform/dataPaths'
import { ArtifactStore } from '../../core/artifacts/artifactStore'

export class ServerModelStore {
  constructor(
    private readonly paths: DataPaths,
    private readonly artifacts: ArtifactStore
  ) {}

  modelPath(model: WhisperModel): string {
    if (!isSupportedWhisperModel(model)) throw new Error('Unsupported Whisper model.')
    return join(this.paths.modelsDir, `ggml-${model}.bin`)
  }

  isReady(model: WhisperModel): boolean {
    const info = WHISPER_MODELS.find((entry) => entry.id === model)
    const path = this.modelPath(model)
    if (!info || !existsSync(path)) return false
    return isWhisperModelSizeAcceptable(statSync(path).size, info.sizeBytes)
  }

  async ensure(
    model: WhisperModel,
    onProgress: (percent: number) => void,
    signal: AbortSignal
  ): Promise<string> {
    const path = this.modelPath(model)
    if (this.isReady(model)) {
      this.registerIfNeeded(path)
      return path
    }
    const info = WHISPER_MODELS.find((entry) => entry.id === model)!
    mkdirSync(this.paths.modelsDir, { recursive: true })
    const partialPath = `${path}.partial`
    rmSync(partialPath, { force: true })
    const response = await fetch(getWhisperModelUrl(model), { signal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}).`)
    const descriptor = openSync(partialPath, 'wx')
    let downloaded = 0
    let downloadError: unknown = null
    try {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        writeSync(descriptor, value)
        downloaded += value.byteLength
        onProgress(Math.min(99, Math.round((downloaded / info.sizeBytes) * 100)))
      }
      fsyncSync(descriptor)
    } catch (error) {
      downloadError = error
    } finally {
      closeSync(descriptor)
    }
    if (downloadError) {
      rmSync(partialPath, { force: true })
      throw downloadError
    }
    if (!isWhisperModelSizeAcceptable(statSync(partialPath).size, info.sizeBytes)) {
      rmSync(partialPath, { force: true })
      throw new Error('Downloaded Whisper model size did not match the expected size.')
    }
    renameSync(partialPath, path)
    this.registerIfNeeded(path)
    onProgress(100)
    return path
  }

  acquireLease(model: WhisperModel, leaseId: string): () => void {
    const path = this.modelPath(model)
    const artifactId = this.registerIfNeeded(path)
    this.artifacts.acquireLease(artifactId, leaseId)
    return () => this.artifacts.releaseLease(artifactId, leaseId)
  }

  delete(model: WhisperModel): boolean {
    const path = this.modelPath(model)
    const artifact = this.artifacts.list().find((entry) => entry.path === path)
    if (!artifact) {
      rmSync(path, { force: true })
      return true
    }
    const preview = this.artifacts.previewCleanup({ artifactIds: [artifact.id] })
    if (preview.artifactCount === 0) return false
    return this.artifacts.executeCleanup(preview.token).deletedIds.includes(artifact.id)
  }

  clear(): { deleted: WhisperModel[]; inUse: WhisperModel[] } {
    const deleted: WhisperModel[] = []
    const inUse: WhisperModel[] = []
    for (const model of WHISPER_MODELS.map((entry) => entry.id)) {
      if (!this.isReady(model)) continue
      if (this.delete(model)) deleted.push(model)
      else inUse.push(model)
    }
    return { deleted, inUse }
  }

  private registerIfNeeded(path: string): string {
    const existing = this.artifacts.list().find((artifact) => artifact.path === path)
    if (existing) return existing.id
    if (!existsSync(path)) throw new Error('Whisper model is unavailable.')
    return this.artifacts.register({
      category: 'model',
      path,
      sizeBytes: statSync(path).size
    }).id
  }
}
