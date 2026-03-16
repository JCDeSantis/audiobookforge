import type { TranscriptionJob, AbsLibrary, AbsBook, AppSettings, WhisperProgressEvent } from '../../../shared/types'

export interface ElectronAPI {
  settings: {
    get: () => Promise<AppSettings>
    setUrl: (url: string) => Promise<void>
    setApiKey: (key: string) => Promise<void>
    setDefaultModel: (model: AppSettings['defaultModel']) => Promise<void>
  }
  files: {
    pickAudio: () => Promise<string[] | null>
    pickEpub: () => Promise<string | null>
    pickOutputFolder: () => Promise<string | null>
    showInExplorer: (path: string) => Promise<void>
  }
  queue: {
    add: (job: Omit<TranscriptionJob, 'id' | 'status' | 'progress' | 'srtPath' | 'srtPaths' | 'error' | 'createdAt' | 'startedAt' | 'completedAt'>) => Promise<TranscriptionJob>
    remove: (jobId: string) => Promise<void>
    reorder: (orderedIds: string[]) => Promise<void>
    cancel: (jobId: string) => Promise<void>
    getAll: () => Promise<TranscriptionJob[]>
    clearDone: () => Promise<void>
    onUpdated: (callback: (jobs: TranscriptionJob[]) => void) => () => void
  }
  abs: {
    testConnection: (url: string, key: string) => Promise<boolean>
    getLibraries: () => Promise<AbsLibrary[]>
    getBooks: (libraryId: string) => Promise<AbsBook[]>
    getBook: (itemId: string) => Promise<AbsBook>
    uploadSubtitle: (itemId: string, srtPath: string) => Promise<void>
  }
  whisper: {
    cancel: () => Promise<void>
    getStorageInfo: () => Promise<{
      binaryReady: boolean
      binaryVersion: string
      gpuEnabled: boolean
      gpuDetected: boolean
      models: Array<{ id: string; name: string; size: string; downloaded: boolean }>
    }>
    onProgress: (callback: (event: WhisperProgressEvent) => void) => () => void
  }
  webUtils: {
    getPathForFile: (file: File) => string
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
