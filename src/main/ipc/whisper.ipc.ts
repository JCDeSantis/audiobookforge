import { ipcMain } from 'electron'
import { existsSync, statSync } from 'fs'
import { cancelTranscription } from '../whisper/transcribe'
import {
  getBinDir,
  isBinaryDownloaded,
  isGpuEnabled,
  detectNvidiaGpu,
  WHISPER_VERSION
} from '../whisper/binary'
import { deleteModel, getModelDir, getModelPath, isModelDownloaded, WHISPER_MODELS } from '../whisper/models'
import { requestCancel } from './queue.ipc'
import { IPC, type WhisperModel } from '../../shared/types'

function getModelDiskInfo(model: WhisperModel): { diskBytes: number; lastModified: number | null } {
  const modelPath = getModelPath(model)
  if (!existsSync(modelPath)) {
    return { diskBytes: 0, lastModified: null }
  }

  try {
    const stats = statSync(modelPath)
    return { diskBytes: stats.size, lastModified: stats.mtimeMs }
  } catch {
    return { diskBytes: 0, lastModified: null }
  }
}

export function registerWhisperIpc(): void {
  ipcMain.handle(IPC.WHISPER_CANCEL, () => {
    requestCancel()
    cancelTranscription()
  })

  ipcMain.handle(IPC.WHISPER_STORAGE_INFO, async () => {
    const gpuDetected = await detectNvidiaGpu()
    return {
      binaryReady: isBinaryDownloaded(),
      binaryVersion: WHISPER_VERSION,
      gpuEnabled: isGpuEnabled(),
      gpuDetected,
      modelDir: getModelDir(),
      binaryDir: getBinDir(),
      models: WHISPER_MODELS.map((m) => ({
        ...getModelDiskInfo(m.id),
        id: m.id,
        name: m.name,
        size: m.size,
        sizeBytes: m.sizeBytes,
        downloaded: isModelDownloaded(m.id)
      }))
    }
  })

  ipcMain.handle(IPC.WHISPER_CLEAR_MODELS, async () => {
    await Promise.all(WHISPER_MODELS.map((model) => deleteModel(model.id)))
  })

  ipcMain.handle(IPC.WHISPER_DELETE_MODEL, async (_event, model: WhisperModel) => {
    if (!WHISPER_MODELS.some((entry) => entry.id === model)) {
      throw new Error('Unsupported whisper model.')
    }

    await deleteModel(model)
  })
}
