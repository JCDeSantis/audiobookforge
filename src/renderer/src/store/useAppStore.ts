import { create } from 'zustand'
import type {
  TranscriptionJob,
  WhisperModel,
  AppSettings,
  AbsLibrary,
  AbsBook,
  AbsBookSummary
} from '../../../shared/types'
import {
  selectAbsItem as applyAbsItemSelection,
  selectLocalFiles as applyLocalFileSelection,
  type JobDraft
} from '../lib/jobDraft'

// ─── Wizard state ─────────────────────────────────────────────────────────────

interface WizardState extends JobDraft {}

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

interface UiState {
  settingsOpen: boolean
  confirmationOpen: boolean
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
  selectLocalFiles: (files: string[]) => void
  selectAbsItem: (item: AbsBookSummary) => void
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

  // UI
  ui: UiState
  setSettingsOpen: (open: boolean) => void
  setConfirmationOpen: (open: boolean) => void
  absModalOpen: boolean
  setAbsModalOpen: (open: boolean) => void
}

function isFreshDraft(wizard: WizardState, defaultModel: WhisperModel): boolean {
  return (
    wizard.source === null &&
    wizard.audioFiles.length === 0 &&
    wizard.absItem === null &&
    wizard.epubPath === null &&
    wizard.outputFolder === null &&
    wizard.model === defaultModel
  )
}

export const useAppStore = create<AppStore>((set) => ({
  // Settings
  settings: { absUrl: '', defaultModel: 'large-v3-turbo' },
  setSettings: (s) =>
    set((state) => ({
      settings: s,
      wizard: isFreshDraft(state.wizard, state.settings.defaultModel)
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
  selectLocalFiles: (audioFiles) =>
    set((state) => ({ wizard: applyLocalFileSelection(state.wizard, audioFiles) })),
  selectAbsItem: (absItem) =>
    set((state) => ({ wizard: applyAbsItemSelection(state.wizard, absItem) })),
  resetWizard: () =>
    set((state) => ({
      wizard: { ...defaultWizard, model: state.settings.defaultModel },
      ui: { ...state.ui, confirmationOpen: false }
    })),

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

  // UI
  ui: { settingsOpen: false, confirmationOpen: false },
  setSettingsOpen: (open) => set((state) => ({ ui: { ...state.ui, settingsOpen: open } })),
  setConfirmationOpen: (open) =>
    set((state) => ({ ui: { ...state.ui, confirmationOpen: open } })),
  absModalOpen: false,
  setAbsModalOpen: (open) => set({ absModalOpen: open })
}))
