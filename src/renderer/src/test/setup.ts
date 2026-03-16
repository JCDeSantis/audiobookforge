import '@testing-library/jest-dom/vitest'

const defaultElectronMock = {
  settings: {
    get: async () => ({ absUrl: '', defaultModel: 'large-v3-turbo' as const }),
    setUrl: async () => undefined,
    setApiKey: async () => undefined,
    setDefaultModel: async () => undefined
  },
  files: {
    pickAudio: async () => null,
    pickEpub: async () => null,
    pickOutputFolder: async () => null,
    showInExplorer: async () => undefined
  },
  queue: {
    add: async () => {
      throw new Error('queue.add mock not configured')
    },
    remove: async () => undefined,
    reorder: async () => undefined,
    cancel: async () => undefined,
    getAll: async () => [],
    clearDone: async () => undefined,
    onUpdated: () => () => undefined
  },
  abs: {
    testConnection: async () => false,
    getLibraries: async () => [],
    getBooks: async () => [],
    getBook: async () => {
      throw new Error('abs.getBook mock not configured')
    },
    uploadSubtitle: async () => undefined
  },
  whisper: {
    cancel: async () => undefined,
    getStorageInfo: async () => ({
      binaryReady: false,
      binaryVersion: '',
      gpuEnabled: false,
      gpuDetected: false,
      models: []
    }),
    onProgress: () => () => undefined
  },
  webUtils: {
    getPathForFile: () => ''
  }
}

Object.defineProperty(window, 'electron', {
  configurable: true,
  writable: true,
  value: defaultElectronMock
})
