import type {
  TranscriptionJob,
  AbsLibrary,
  AbsBook,
  AppSettings,
  WhisperProgressEvent,
  WhisperStorageInfo
} from '../../../shared/types'
import type {
  AbsLoginResult,
  ComputePreference,
  ManagedCleanupPreview,
  ManagedStorageSummary,
  RuntimeCapabilities
} from '../../../shared/types'
import type { WebUploadSelection } from '../../../shared/types'

export interface AppClient {
  runtime: {
    getCapabilities: () => Promise<RuntimeCapabilities>
  }
  settings: {
    get: () => Promise<AppSettings>
    setUrl: (url: string) => Promise<void>
    setDefaultModel: (model: AppSettings['defaultModel']) => Promise<void>
    setComputePreference: (preference: ComputePreference) => Promise<void>
  }
  files: {
    pickAudio: () => Promise<string[] | null>
    pickEpub: () => Promise<string | null>
    pickOutputFolder: () => Promise<string | null>
    showInExplorer: (path: string) => Promise<void>
    downloadArtifact: (artifactId: string) => Promise<void>
    downloadJobResults: (jobId: string) => Promise<void>
  }
  uploads: {
    uploadFiles: (
      files: File[],
      onProgress: (percent: number) => void
    ) => Promise<WebUploadSelection>
  }
  queue: {
    add: (job: Omit<TranscriptionJob, 'id' | 'status' | 'progress' | 'srtPath' | 'srtPaths' | 'qualityReport' | 'error' | 'createdAt' | 'startedAt' | 'completedAt'>) => Promise<TranscriptionJob>
    remove: (jobId: string) => Promise<void>
    reorder: (orderedIds: string[]) => Promise<void>
    cancel: (jobId: string) => Promise<void>
    pause: (jobId: string) => Promise<void>
    resume: (jobId: string) => Promise<void>
    retry: (jobId: string, model?: TranscriptionJob['model']) => Promise<TranscriptionJob>
    getAll: () => Promise<TranscriptionJob[]>
    clearDone: () => Promise<void>
    onUpdated: (callback: (jobs: TranscriptionJob[]) => void) => () => void
  }
  abs: {
    login: (url: string, username: string, password: string) => Promise<AbsLoginResult>
    logout: () => Promise<void>
    getLibraries: () => Promise<AbsLibrary[]>
    getBooks: (libraryId: string) => Promise<AbsBook[]>
    getBook: (itemId: string) => Promise<AbsBook>
  }
  whisper: {
    cancel: () => Promise<void>
    getStorageInfo: () => Promise<WhisperStorageInfo>
    clearModels: () => Promise<void>
    deleteModel: (model: TranscriptionJob['model']) => Promise<void>
    onProgress: (callback: (event: WhisperProgressEvent) => void) => () => void
  }
  diagnostics: {
    export: () => Promise<string | null>
  }
  storage: {
    getSummary: () => Promise<ManagedStorageSummary>
    previewCleanup: () => Promise<ManagedCleanupPreview>
    executeCleanup: (token: string) => Promise<{ deletedIds: string[]; failedIds: string[] }>
  }
}

export type ElectronAPI = AppClient

declare global {
  interface Window {
    electron: AppClient
  }
}
