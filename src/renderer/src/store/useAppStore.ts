import { create } from 'zustand'
import type {
  TranscriptionJob,
  WhisperModel,
  AppSettings,
  AbsLibrary,
  AbsBook,
  AbsBookSummary
} from '../../../shared/types'

// ─── Wizard state ─────────────────────────────────────────────────────────────

interface WizardState {
  step: 1 | 2 | 3
  source: 'local' | 'abs' | null
  audioFiles: string[]
  absItem: AbsBookSummary | null
  epubPath: string | null
  model: WhisperModel
  outputFolder: string | null
}

const defaultWizard: WizardState = {
  step: 1,
  source: null,
  audioFiles: [],
  absItem: null,
  epubPath: null,
  model: 'large-v3-turbo',
  outputFolder: null
}

// ─── Queue state ──────────────────────────────────────────────────────────────

interface QueueState {
  jobs: TranscriptionJob[]
  activeJobId: string | null
}

// ─── ABS library cache ────────────────────────────────────────────────────────

interface AbsLibraryState {
  connected: boolean
  libraries: AbsLibrary[]
  books: Record<string, AbsBook[]>
  lastFetched: number | null
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface AppStore {
  // Settings
  settings: AppSettings
  setSettings: (s: AppSettings) => void

  // Wizard
  wizard: WizardState
  setWizardStep: (step: 1 | 2 | 3) => void
  setWizardSource: (source: 'local' | 'abs') => void
  setWizardAudioFiles: (files: string[]) => void
  setWizardAbsItem: (item: AbsBookSummary | null) => void
  setWizardEpubPath: (path: string | null) => void
  setWizardModel: (model: WhisperModel) => void
  setWizardOutputFolder: (folder: string | null) => void
  resetWizard: () => void

  // Queue
  queue: QueueState
  setJobs: (jobs: TranscriptionJob[]) => void

  // ABS library
  absLibrary: AbsLibraryState
  setAbsConnected: (connected: boolean) => void
  setAbsLibraries: (libraries: AbsLibrary[]) => void
  setAbsBooks: (libraryId: string, books: AbsBook[]) => void
  clearAbsCache: () => void

  // ABS Library Modal
  absModalOpen: boolean
  setAbsModalOpen: (open: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  // Settings
  settings: { absUrl: '', defaultModel: 'large-v3-turbo' },
  setSettings: (s) =>
    set((state) => ({
      settings: s,
      wizard:
        state.wizard.source === null && state.wizard.step === 1
          ? { ...state.wizard, model: s.defaultModel }
          : state.wizard
    })),

  // Wizard
  wizard: defaultWizard,
  setWizardStep: (step) => set((state) => ({ wizard: { ...state.wizard, step } })),
  setWizardSource: (source) => set((state) => ({ wizard: { ...state.wizard, source } })),
  setWizardAudioFiles: (audioFiles) =>
    set((state) => ({ wizard: { ...state.wizard, audioFiles } })),
  setWizardAbsItem: (absItem) =>
    set((state) => ({ wizard: { ...state.wizard, absItem } })),
  setWizardEpubPath: (epubPath) =>
    set((state) => ({ wizard: { ...state.wizard, epubPath } })),
  setWizardModel: (model) => set((state) => ({ wizard: { ...state.wizard, model } })),
  setWizardOutputFolder: (outputFolder) =>
    set((state) => ({ wizard: { ...state.wizard, outputFolder } })),
  resetWizard: () =>
    set((state) => ({ wizard: { ...defaultWizard, model: state.settings.defaultModel } })),

  // Queue
  queue: { jobs: [], activeJobId: null },
  setJobs: (jobs) =>
    set({
      queue: {
        jobs,
        activeJobId: jobs.find((j) => j.status === 'running')?.id ?? null
      }
    }),

  // ABS library
  absLibrary: { connected: false, libraries: [], books: {}, lastFetched: null },
  setAbsConnected: (connected) =>
    set((state) => ({ absLibrary: { ...state.absLibrary, connected } })),
  setAbsLibraries: (libraries) =>
    set((state) => ({
      absLibrary: { ...state.absLibrary, libraries, lastFetched: Date.now() }
    })),
  setAbsBooks: (libraryId, books) =>
    set((state) => ({
      absLibrary: {
        ...state.absLibrary,
        books: { ...state.absLibrary.books, [libraryId]: books }
      }
    })),
  clearAbsCache: () =>
    set((state) => ({
      absLibrary: { ...state.absLibrary, libraries: [], books: {}, lastFetched: null }
    })),

  // ABS Library Modal
  absModalOpen: false,
  setAbsModalOpen: (open) => set({ absModalOpen: open })
}))
