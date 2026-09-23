import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'

const electron = {
  runtime: {
    getCapabilities: () => ipcRenderer.invoke(IPC.RUNTIME_CAPABILITIES)
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    setUrl: (url: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_URL, url),
    setDefaultModel: (model: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_DEFAULT_MODEL, model),
    setComputePreference: (preference: string) =>
      ipcRenderer.invoke(IPC.SETTINGS_SET_COMPUTE_PREFERENCE, preference)
  },

  files: {
    pickAudio: () => ipcRenderer.invoke(IPC.FILES_PICK_AUDIO),
    pickEpub: () => ipcRenderer.invoke(IPC.FILES_PICK_EPUB),
    pickOutputFolder: () => ipcRenderer.invoke(IPC.FILES_PICK_OUTPUT_FOLDER),
    showInExplorer: (path: string) => ipcRenderer.invoke(IPC.FILES_SHOW_IN_EXPLORER, path),
    downloadArtifact: () =>
      Promise.reject(new Error('Managed result downloads are available in the web runtime only.')),
    downloadJobResults: () =>
      Promise.reject(new Error('Managed result downloads are available in the web runtime only.'))
  },

  uploads: {
    uploadFiles: () => Promise.reject(new Error('Browser uploads are unavailable in Electron.'))
  },

  queue: {
    add: (job: Parameters<typeof ipcRenderer.invoke>[1]) => ipcRenderer.invoke(IPC.QUEUE_ADD, job),
    remove: (jobId: string) => ipcRenderer.invoke(IPC.QUEUE_REMOVE, jobId),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC.QUEUE_REORDER, orderedIds),
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.QUEUE_CANCEL, jobId),
    pause: (jobId: string) => ipcRenderer.invoke(IPC.QUEUE_PAUSE, jobId),
    resume: (jobId: string) => ipcRenderer.invoke(IPC.QUEUE_RESUME, jobId),
    retry: (jobId: string, model?: string) => ipcRenderer.invoke(IPC.QUEUE_RETRY, { jobId, model }),
    getAll: () => ipcRenderer.invoke(IPC.QUEUE_GET_ALL),
    clearDone: () => ipcRenderer.invoke(IPC.QUEUE_CLEAR_DONE),
    onUpdated: (callback: (jobs: unknown[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, jobs: unknown[]): void => callback(jobs)
      ipcRenderer.on(IPC.QUEUE_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC.QUEUE_UPDATED, handler)
    }
  },

  abs: {
    login: (url: string, username: string, password: string) =>
      ipcRenderer.invoke(IPC.ABS_LOGIN, url, username, password),
    logout: () => ipcRenderer.invoke(IPC.ABS_LOGOUT),
    getLibraries: () => ipcRenderer.invoke(IPC.ABS_GET_LIBRARIES),
    getBooks: (libraryId: string) => ipcRenderer.invoke(IPC.ABS_GET_BOOKS, libraryId),
    getBook: (itemId: string) => ipcRenderer.invoke(IPC.ABS_GET_BOOK, itemId)
  },

  whisper: {
    cancel: () => ipcRenderer.invoke(IPC.WHISPER_CANCEL),
    getStorageInfo: () => ipcRenderer.invoke(IPC.WHISPER_STORAGE_INFO),
    clearModels: () => ipcRenderer.invoke(IPC.WHISPER_CLEAR_MODELS),
    deleteModel: (model: string) => ipcRenderer.invoke(IPC.WHISPER_DELETE_MODEL, model),
    onProgress: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
      ipcRenderer.on(IPC.WHISPER_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.WHISPER_PROGRESS, handler)
    }
  },

  diagnostics: {
    export: () => ipcRenderer.invoke(IPC.DIAGNOSTICS_EXPORT)
  },

  storage: {
    getSummary: () => ipcRenderer.invoke(IPC.STORAGE_SUMMARY),
    previewCleanup: () => ipcRenderer.invoke(IPC.STORAGE_CLEANUP_PREVIEW),
    executeCleanup: (token: string) => ipcRenderer.invoke(IPC.STORAGE_CLEANUP_EXECUTE, token)
  }
}

contextBridge.exposeInMainWorld('electron', electron)
