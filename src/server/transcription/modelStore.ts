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
    if (this.isReady(model)) return path
    const info = WHISPER_MODELS.find((entry) => entry.id === model)!
    mkdirSync(this.paths.modelsDir, { recursive: true })
    const partialPath = `${path}.partial`
    rmSync(partialPath, { force: true })
    const response = await fetch(getWhisperModelUrl(model), { signal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}).`)
    const descriptor = openSync(partialPath, 'wx')
    let downloaded = 0
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
      rmSync(partialPath, { force: true })
      throw error
    } finally {
      closeSync(descriptor)
    }
    if (!isWhisperModelSizeAcceptable(statSync(partialPath).size, info.sizeBytes)) {
      rmSync(partialPath, { force: true })
      throw new Error('Downloaded Whisper model size did not match the expected size.')
    }
    renameSync(partialPath, path)
    if (!this.artifacts.list().some((artifact) => artifact.path === path)) {
      this.artifacts.register({ category: 'model', path, sizeBytes: statSync(path).size })
    }
    onProgress(100)
    return path
  }
}
