import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

const defaultElectronMock = {
  runtime: {
    getCapabilities: async () => ({
      runtime: 'windows-desktop' as const,
      nativeFilePicker: true,
      browserUploads: false,
      nativeOutputFolder: true,
      resultDownloads: false,
      singleUser: true as const
    })
  },
  settings: {
    get: async () => ({
      absUrl: '',
      absUsername: '',
      defaultModel: 'large-v3-turbo-q5_0' as const,
      computePreference: 'automatic' as const
    }),
    setUrl: async () => undefined,
    setDefaultModel: async () => undefined,
    setComputePreference: async () => undefined
  },
  files: {
    pickAudio: async () => null,
    pickEpub: async () => null,
    pickOutputFolder: async () => null,
    showInExplorer: async () => undefined,
    downloadArtifact: async () => undefined
  },
  queue: {
    add: async () => {
      throw new Error('queue.add mock not configured')
    },
    remove: async () => undefined,
    reorder: async () => undefined,
    cancel: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    retry: async () => undefined,
    getAll: async () => [],
    clearDone: async () => undefined,
    onUpdated: () => () => undefined
  },
  abs: {
    login: async () => ({ username: 'test', userType: 'user', serverVersion: '2.0.0' }),
    logout: async () => undefined,
    getLibraries: async () => [],
    getBooks: async () => [],
    getBook: async () => {
      throw new Error('abs.getBook mock not configured')
    }
  },
  uploads: {
    uploadFiles: async () => {
      throw new Error('uploads.uploadFiles mock not configured')
    }
  },
  whisper: {
    cancel: async () => undefined,
    getStorageInfo: async () => ({
      binaryReady: false,
      binaryVersion: '',
      gpuEnabled: false,
      gpuDetected: false,
      modelDir: '',
      binaryDir: '',
      models: []
    }),
    clearModels: async () => undefined,
    deleteModel: async () => undefined,
    onProgress: () => () => undefined
  },
  diagnostics: {
    export: async () => null
  },
  storage: {
    getSummary: async () => ({ totalBytes: 0, artifactCount: 0, byCategory: {} }),
    previewCleanup: async () => ({
      token: 'preview-token',
      revision: 0,
      artifactCount: 0,
      sizeBytes: 0
    }),
    executeCleanup: async () => ({ deletedIds: [], failedIds: [] })
  }
}

Object.defineProperty(window, 'electron', {
  configurable: true,
  writable: true,
  value: defaultElectronMock
})

afterEach(() => {
  cleanup()
})
