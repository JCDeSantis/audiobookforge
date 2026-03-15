import { ipcMain } from 'electron'
import { cancelTranscription } from '../whisper/transcribe'
import {
  isBinaryDownloaded,
  isGpuEnabled,
  detectNvidiaGpu,
  WHISPER_VERSION
} from '../whisper/binary'
import { isModelDownloaded, WHISPER_MODELS } from '../whisper/models'
import { requestCancel } from './queue.ipc'
import { IPC } from '../../shared/types'

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
      models: WHISPER_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        size: m.size,
        downloaded: isModelDownloaded(m.id)
      }))
    }
  })
}
