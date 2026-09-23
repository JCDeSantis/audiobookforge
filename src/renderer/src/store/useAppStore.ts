import { create } from 'zustand'
import type {
  TranscriptionJob,
  WhisperModel,
  AppSettings,
  AbsLibrary,
  AbsBook,
  AbsBookSummary,
  SubtitleFormat
} from '../../../shared/types'
import {
  clearSelectedSource as clearDraftSource,
  selectAbsItem as applyAbsItemSelection,
  selectAbsItems as applyAbsItemsSelection,
  selectLocalFiles as applyLocalFileSelection,
  selectWebUpload as applyWebUploadSelection,
  type JobDraft
} from '../lib/jobDraft'

// ─── Wizard state ─────────────────────────────────────────────────────────────

interface WizardState extends JobDraft {}

const defaultWizard: WizardState = {
  source: null,
  audioFiles: [],
  uploadSessionId: null,
  uploadEpubFileName: null,
  absItem: null,
  absItems: [],
  epubPath: null,
  model: 'large-v3-turbo-q5_0',
  subtitleFormats: ['srt'],
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
  setWizardEpubPath: (path: string | null) => void
  setWizardModel: (model: WhisperModel) => void
  setWizardSubtitleFormat: (format: SubtitleFormat, enabled: boolean) => void
  setWizardOutputFolder: (folder: string | null) => void
  selectLocalFiles: (files: string[]) => void
  selectWebUpload: (
    sessionId: string,
    audioFileNames: string[],
    epubFileName: string | null
  ) => void
  selectAbsItem: (item: AbsBookSummary) => void
  selectAbsItems: (items: AbsBookSummary[]) => void
  clearSelectedSource: () => void
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
    wizard.uploadSessionId == null &&
    wizard.absItem === null &&
    wizard.absItems.length === 0 &&
    wizard.epubPath === null &&
    wizard.outputFolder === null &&
    wizard.model === defaultModel &&
    wizard.subtitleFormats.length === 1 &&
    wizard.subtitleFormats[0] === 'srt'
  )
}

export const useAppStore = create<AppStore>((set) => ({
  // Settings
  settings: { absUrl: '', absUsername: '', defaultModel: 'large-v3-turbo-q5_0' },
  setSettings: (s) =>
    set((state) => ({
      settings: s,
      wizard: isFreshDraft(state.wizard, state.settings.defaultModel)
        ? { ...state.wizard, model: s.defaultModel }
        : state.wizard
    })),

  // Wizard
  wizard: defaultWizard,
  setWizardEpubPath: (epubPath) => set((state) => ({ wizard: { ...state.wizard, epubPath } })),
  setWizardModel: (model) => set((state) => ({ wizard: { ...state.wizard, model } })),
  setWizardSubtitleFormat: (format, enabled) =>
    set((state) => {
      const formats = new Set(state.wizard.subtitleFormats)
      formats.add('srt')
      if (format !== 'srt') {
        if (enabled) formats.add(format)
        else formats.delete(format)
      }
      return { wizard: { ...state.wizard, subtitleFormats: Array.from(formats) } }
    }),
  setWizardOutputFolder: (outputFolder) =>
    set((state) => ({ wizard: { ...state.wizard, outputFolder } })),
  selectLocalFiles: (audioFiles) =>
    set((state) => ({ wizard: applyLocalFileSelection(state.wizard, audioFiles) })),
  selectWebUpload: (sessionId, audioFileNames, epubFileName) =>
    set((state) => ({
      wizard: applyWebUploadSelection(state.wizard, sessionId, audioFileNames, epubFileName)
    })),
  selectAbsItem: (absItem) =>
    set((state) => ({ wizard: applyAbsItemSelection(state.wizard, absItem) })),
  selectAbsItems: (absItems) =>
    set((state) => ({ wizard: applyAbsItemsSelection(state.wizard, absItems) })),
  clearSelectedSource: () => set((state) => ({ wizard: clearDraftSource(state.wizard) })),
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
  setConfirmationOpen: (open) => set((state) => ({ ui: { ...state.ui, confirmationOpen: open } })),
  absModalOpen: false,
  setAbsModalOpen: (open) => set({ absModalOpen: open })
}))
