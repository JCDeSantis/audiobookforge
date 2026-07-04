// ─── FFmpeg ───────────────────────────────────────────────────────────────────

export interface ProbeResult {
  duration: number
  format: string
  tags: Record<string, string>
  hasCoverArt: boolean
  chapters: ProbeChapter[]
}

export interface ProbeChapter {
  startSec: number
  endSec: number
  title: string | null
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

export interface WhisperStorageInfo {
  binaryReady: boolean
  binaryVersion: string
  gpuEnabled: boolean
  gpuDetected: boolean
  modelDir: string
  binaryDir: string
  models: Array<{
    id: WhisperModel
    name: string
    size: string
    sizeBytes: number
    diskBytes: number
    downloaded: boolean
    lastModified: number | null
  }>
}

export interface TranscriptionQualityIssue {
  severity: 'info' | 'warning' | 'error'
  code: 'no-cues' | 'low-coverage' | 'large-gap' | 'long-cue' | 'repeated-text' | 'upload-fallback'
  message: string
  startSec?: number
  endSec?: number
}

export interface TranscriptionQualityReport {
  cueCount: number
  durationSec: number
  coverageSec: number
  coveragePercent: number
  largestGapSec: number
  longestCueSec: number
  issueCount: number
  issues: TranscriptionQualityIssue[]
  generatedAt: number
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

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
export type SubtitleFormat = 'srt' | 'vtt' | 'lrc'

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
  subtitleFormats?: SubtitleFormat[]
  progress: WhisperProgressEvent | null
  srtPath: string | null // temp path during/after transcription
  srtPaths: string[] // all saved subtitle-format paths for completed local fallback/output jobs
  qualityReport: TranscriptionQualityReport | null
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
  ebookDownloadUrl?: string | null // authenticated portable download URL when ABS exposes a file id
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
  ebookDownloadUrl?: string | null
  audioFiles: AbsAudioFile[]
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  absUrl: string
  absUsername?: string
  defaultModel: WhisperModel
  computePreference?: ComputePreference
}

export interface RuntimeCapabilities {
  runtime: 'windows-desktop' | 'docker-web'
  nativeFilePicker: boolean
  browserUploads: boolean
  nativeOutputFolder: boolean
  resultDownloads: boolean
  singleUser: true
}

export type ComputePreference = 'automatic' | 'cpu'
export type ComputeBackend = 'cuda' | 'cpu' | 'unknown'

export interface ComputeStatus {
  preference: ComputePreference
  detectedBackend: ComputeBackend
  activeBackend: ComputeBackend
  fallbackReason: string | null
}

export interface ManagedStorageSummary {
  totalBytes: number
  artifactCount: number
  byCategory: Record<string, { bytes: number; count: number }>
}

export interface ManagedCleanupPreview {
  token: string
  revision: number
  artifactCount: number
  sizeBytes: number
}

export interface AbsLoginResult {
  username: string
  userType: string
  serverVersion: string
  connectionWarning?: string
}

// ─── IPC channels ────────────────────────────────────────────────────────────

export const IPC = {
  // Runtime
  RUNTIME_CAPABILITIES: 'runtime:capabilities',

  // Whisper
  WHISPER_PROGRESS: 'whisper:progress',
  WHISPER_CANCEL: 'whisper:cancel',
  WHISPER_STORAGE_INFO: 'whisper:storage-info',
  WHISPER_CLEAR_MODELS: 'whisper:clear-models',
  WHISPER_DELETE_MODEL: 'whisper:delete-model',

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
  QUEUE_PAUSE: 'queue:pause',
  QUEUE_RESUME: 'queue:resume',
  QUEUE_RETRY: 'queue:retry',
  QUEUE_GET_ALL: 'queue:get-all',
  QUEUE_CLEAR_DONE: 'queue:clear-done',
  QUEUE_UPDATED: 'queue:updated',

  // Diagnostics
  DIAGNOSTICS_EXPORT: 'diagnostics:export',

  // Managed storage
  STORAGE_SUMMARY: 'storage:summary',
  STORAGE_CLEANUP_PREVIEW: 'storage:cleanup-preview',
  STORAGE_CLEANUP_EXECUTE: 'storage:cleanup-execute',

  // ABS
  ABS_LOGIN: 'abs:login',
  ABS_LOGOUT: 'abs:logout',
  ABS_GET_LIBRARIES: 'abs:get-libraries',
  ABS_GET_BOOKS: 'abs:get-books',
  ABS_GET_BOOK: 'abs:get-book',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET_URL: 'settings:set-url',
  SETTINGS_SET_DEFAULT_MODEL: 'settings:set-default-model',
  SETTINGS_SET_COMPUTE_PREFERENCE: 'settings:set-compute-preference'
} as const
