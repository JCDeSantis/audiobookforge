import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'

const electron = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    setUrl: (url: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_URL, url),
    setApiKey: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_API_KEY, key),
    setDefaultModel: (model: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_DEFAULT_MODEL, model)
  },

  files: {
    pickAudio: () => ipcRenderer.invoke(IPC.FILES_PICK_AUDIO),
    pickEpub: () => ipcRenderer.invoke(IPC.FILES_PICK_EPUB),
    pickOutputFolder: () => ipcRenderer.invoke(IPC.FILES_PICK_OUTPUT_FOLDER),
    showInExplorer: (path: string) => ipcRenderer.invoke(IPC.FILES_SHOW_IN_EXPLORER, path)
  },

  queue: {
    add: (job: Parameters<typeof ipcRenderer.invoke>[1]) => ipcRenderer.invoke(IPC.QUEUE_ADD, job),
    remove: (jobId: string) => ipcRenderer.invoke(IPC.QUEUE_REMOVE, jobId),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC.QUEUE_REORDER, orderedIds),
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.QUEUE_CANCEL, jobId),
    getAll: () => ipcRenderer.invoke(IPC.QUEUE_GET_ALL),
    clearDone: () => ipcRenderer.invoke(IPC.QUEUE_CLEAR_DONE),
    onUpdated: (callback: (jobs: unknown[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, jobs: unknown[]): void => callback(jobs)
      ipcRenderer.on(IPC.QUEUE_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC.QUEUE_UPDATED, handler)
    }
  },

  abs: {
    testConnection: (url: string, key: string) => ipcRenderer.invoke(IPC.ABS_TEST_CONNECTION, url, key),
    getLibraries: () => ipcRenderer.invoke(IPC.ABS_GET_LIBRARIES),
    getBooks: (libraryId: string) => ipcRenderer.invoke(IPC.ABS_GET_BOOKS, libraryId),
    getBook: (itemId: string) => ipcRenderer.invoke(IPC.ABS_GET_BOOK, itemId)
  },

  whisper: {
    cancel: () => ipcRenderer.invoke(IPC.WHISPER_CANCEL),
    getStorageInfo: () => ipcRenderer.invoke(IPC.WHISPER_STORAGE_INFO),
    clearModels: () => ipcRenderer.invoke(IPC.WHISPER_CLEAR_MODELS),
    onProgress: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
      ipcRenderer.on(IPC.WHISPER_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.WHISPER_PROGRESS, handler)
    }
  }
}

contextBridge.exposeInMainWorld('electron', electron)
