// ─── FFmpeg ───────────────────────────────────────────────────────────────────

export interface ProbeResult {
  duration: number
  format: string
  tags: Record<string, string>
  hasCoverArt: boolean
}

// ─── Whisper ────────────────────────────────────────────────────────────────

export type WhisperModel =
  | 'tiny'
  | 'base'
  | 'small'
  | 'medium'
  | 'large-v2'
  | 'large-v3'
  | 'large-v3-turbo'
  | 'large-v3-turbo-q5_0'

export interface WhisperModelInfo {
  id: WhisperModel
  name: string
  size: string
  sizeBytes: number
  description: string
}

export type WhisperProgressPhase =
  | 'downloading-binary'
  | 'downloading-model'
  | 'preparing'
  | 'segmenting'
  | 'transcribing'
  | 'uploading'
  | 'done'
  | 'error'

export interface WhisperProgressEvent {
  jobId: string
  phase: WhisperProgressPhase
  percent: number
  overallPercent?: number
  segmentIndex?: number
  segmentCount?: number
  liveText?: string
  error?: string
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TranscriptionJob {
  id: string
  status: JobStatus
  source: 'local' | 'abs'
  title: string
  audioFiles: string[]
  outputPath: string | null // output folder for local jobs; null for ABS
  absItemId: string | null
  absLibraryId: string | null
  absFolderId: string | null
  absAuthorName: string | null
  epubPath: string | null
  model: WhisperModel
  progress: WhisperProgressEvent | null
  srtPath: string | null // temp path during/after transcription
  srtPaths: string[] // all saved subtitle paths for completed local fallback/output jobs
  error: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

// ─── ABS ─────────────────────────────────────────────────────────────────────

export interface AbsLibrary {
  id: string
  name: string
  mediaType: string
}

export interface AbsAudioFile {
  index: number
  ino: string
  contentUrl: string | null
  metadata: { filename: string; ext: string; path: string; relPath: string }
  duration: number
  mimeType: string
  addedAt: number
  updatedAt: number
}

export interface AbsBook {
  id: string
  libraryId: string
  folderId: string
  relPath: string
  isFile: boolean
  title: string
  authorName: string
  duration: number // seconds
  cover: string | null // cover URL relative to ABS server
  hasSubtitles: boolean
  ebookPath: string | null // absolute path if same-machine ABS
  audioFiles: AbsAudioFile[]
}

export interface AbsBookSummary {
  id: string
  libraryId: string
  folderId: string
  relPath: string
  isFile: boolean
  title: string
  authorName: string
  duration: number
  cover: string | null
  hasSubtitles: boolean
  ebookPath: string | null
  audioFiles: AbsAudioFile[]
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  absUrl: string
  defaultModel: WhisperModel
}

// ─── IPC channels ────────────────────────────────────────────────────────────

export const IPC = {
  // Whisper
  WHISPER_PROGRESS: 'whisper:progress',
  WHISPER_CANCEL: 'whisper:cancel',
  WHISPER_STORAGE_INFO: 'whisper:storage-info',

  // Files
  FILES_PICK_AUDIO: 'files:pick-audio',
  FILES_PICK_EPUB: 'files:pick-epub',
  FILES_PICK_OUTPUT_FOLDER: 'files:pick-output-folder',
  FILES_SHOW_IN_EXPLORER: 'files:show-in-explorer',

  // Queue
  QUEUE_ADD: 'queue:add',
  QUEUE_REMOVE: 'queue:remove',
  QUEUE_REORDER: 'queue:reorder',
  QUEUE_CANCEL: 'queue:cancel',
  QUEUE_GET_ALL: 'queue:get-all',
  QUEUE_CLEAR_DONE: 'queue:clear-done',
  QUEUE_UPDATED: 'queue:updated',

  // ABS
  ABS_TEST_CONNECTION: 'abs:test-connection',
  ABS_GET_LIBRARIES: 'abs:get-libraries',
  ABS_GET_BOOKS: 'abs:get-books',
  ABS_GET_BOOK: 'abs:get-book',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET_URL: 'settings:set-url',
  SETTINGS_SET_API_KEY: 'settings:set-api-key',
  SETTINGS_SET_DEFAULT_MODEL: 'settings:set-default-model'
} as const
