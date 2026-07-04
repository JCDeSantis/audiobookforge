import { ipcMain, app } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, createWriteStream } from 'fs'
import { join, basename, extname, isAbsolute } from 'path'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import Epub from 'epub2'
import {
  cancelTranscription,
  clearTranscriptionCheckpoint,
  transcribeAudio
} from '../whisper/transcribe'
import { isBinaryDownloaded } from '../whisper/binary'
import { isModelDownloaded, WHISPER_MODELS } from '../whisper/models'
import { probeFile, sumDurations } from '../ffmpeg/probe'
import { parseSrtContent, splitSrtByDurations } from '../whisper/segments'
import { createQualityReport } from '../whisper/quality'
import { convertSrtToFormat } from '../whisper/subtitleFormats'
import { createJobProgressPlan, mapOverallProgressEvent } from '../../shared/jobProgress'
import {
  buildAbsAudioPaths,
  fetchAbsBook,
  resolveAbsAccessToken,
  uploadSubtitleToAbs
} from './abs.ipc'
import { loadSettings } from './settings.ipc'
import { IPC } from '../../shared/types'
import { isSameUrlOrigin, validateAbsUrl } from '../../shared/urlSafety'
import type {
  SubtitleFormat,
  TranscriptionJob,
  WhisperModel,
  WhisperProgressEvent
} from '../../shared/types'
import {
  PersistenceError,
  readVersionedJson,
  writeVersionedJson
} from '../../core/persistence/atomicJsonStore'
import { getDesktopDataPaths } from '../platform/desktopDataPaths'
import { trackDesktopManagedArtifact } from '../platform/desktopArtifacts'

type QueueAddPayload = Omit<
  TranscriptionJob,
  | 'id'
  | 'status'
  | 'progress'
  | 'srtPath'
  | 'srtPaths'
  | 'qualityReport'
  | 'error'
  | 'createdAt'
  | 'startedAt'
  | 'completedAt'
>

const VALID_MODELS = new Set<WhisperModel>(WHISPER_MODELS.map((model) => model.id))
const VALID_SUBTITLE_FORMATS = new Set<SubtitleFormat>(['srt', 'vtt', 'lrc'])
const VALID_JOB_STATUSES = new Set<TranscriptionJob['status']>([
  'queued',
  'running',
  'paused',
  'done',
  'failed',
  'cancelled'
])
const QUEUE_SCHEMA_VERSION = 1
const MANAGED_RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

let jobs: TranscriptionJob[] = []
let activeJobId: string | null = null
let cancelRequested = false
let pauseRequested = false
let activeDownloadAbortController: AbortController | null = null
let win: BrowserWindow | null = null
let queueIpcRegistered = false

function getQueuePath(): string {
  return getDesktopDataPaths().queueFile
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sanitizeTitle(value: unknown): string {
  return isNonEmptyString(value) ? value.trim().slice(0, 300) : 'Untitled'
}

function sanitizeOptionalAbsolutePath(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error('Local file paths must be absolute.')
  }

  return value
}

function sanitizeLocalAudioFiles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Local jobs need at least one audio file.')
  }

  return value.map((entry) => {
    if (typeof entry !== 'string' || !isAbsolute(entry)) {
      throw new Error('Local audio files must be absolute paths selected from disk.')
    }

    return entry
  })
}

function sanitizeModel(value: unknown): WhisperModel {
  if (typeof value !== 'string' || !VALID_MODELS.has(value as WhisperModel)) {
    throw new Error('Unsupported whisper model.')
  }

  return value as WhisperModel
}

function sanitizeSubtitleFormats(value: unknown): SubtitleFormat[] {
  if (value === undefined) return ['srt']
  if (!Array.isArray(value)) throw new Error('Subtitle formats must be an array.')

  for (const format of value) {
    if (typeof format !== 'string' || !VALID_SUBTITLE_FORMATS.has(format as SubtitleFormat)) {
      throw new Error('Unsupported subtitle format.')
    }
  }

  const requested = new Set<SubtitleFormat>(value as SubtitleFormat[])
  requested.add('srt')
  return (['srt', 'vtt', 'lrc'] as SubtitleFormat[]).filter((format) => requested.has(format))
}

function sanitizeQueueAddPayload(jobData: unknown): QueueAddPayload {
  if (!jobData || typeof jobData !== 'object') {
    throw new Error('Invalid queue job payload.')
  }

  const candidate = jobData as Partial<QueueAddPayload>
  const source = candidate.source

  if (source === 'local') {
    const outputPath = sanitizeOptionalAbsolutePath(candidate.outputPath)
    if (!outputPath) {
      throw new Error('Local jobs require an output folder.')
    }

    return {
      source,
      title: sanitizeTitle(candidate.title),
      audioFiles: sanitizeLocalAudioFiles(candidate.audioFiles),
      outputPath,
      absItemId: null,
      absLibraryId: null,
      absFolderId: null,
      absAuthorName: null,
      epubPath: sanitizeOptionalAbsolutePath(candidate.epubPath),
      model: sanitizeModel(candidate.model),
      subtitleFormats: sanitizeSubtitleFormats(candidate.subtitleFormats)
    }
  }

  if (source === 'abs') {
    if (!isNonEmptyString(candidate.absItemId)) {
      throw new Error('AudioBookShelf jobs require a valid library item id.')
    }
    if (!isNonEmptyString(candidate.absLibraryId)) {
      throw new Error('AudioBookShelf jobs require a valid library id.')
    }
    if (!isNonEmptyString(candidate.absFolderId)) {
      throw new Error('AudioBookShelf jobs require a valid folder id.')
    }

    return {
      source,
      title: sanitizeTitle(candidate.title),
      audioFiles: [],
      outputPath: null,
      absItemId: candidate.absItemId.trim(),
      absLibraryId: candidate.absLibraryId.trim(),
      absFolderId: candidate.absFolderId.trim(),
      absAuthorName: isNonEmptyString(candidate.absAuthorName)
        ? candidate.absAuthorName.trim()
        : null,
      epubPath: sanitizeOptionalAbsolutePath(candidate.epubPath),
      model: sanitizeModel(candidate.model),
      subtitleFormats: sanitizeSubtitleFormats(candidate.subtitleFormats)
    }
  }

  throw new Error('Unsupported queue job source.')
}

function hydrateQueueJob(rawJob: Partial<TranscriptionJob>): TranscriptionJob | null {
  if (typeof rawJob.id !== 'string' || rawJob.id.trim().length === 0) {
    return null
  }

  try {
    const payload = sanitizeQueueAddPayload(rawJob)

    return {
      ...payload,
      id: rawJob.id,
      status:
        typeof rawJob.status === 'string' && VALID_JOB_STATUSES.has(rawJob.status)
          ? rawJob.status
          : 'queued',
      progress: rawJob.progress ?? null,
      srtPath: sanitizeOptionalAbsolutePath(rawJob.srtPath),
      srtPaths: Array.isArray(rawJob.srtPaths)
        ? rawJob.srtPaths.filter(
            (path): path is string => typeof path === 'string' && isAbsolute(path)
          )
        : [],
      qualityReport: rawJob.qualityReport ?? null,
      error: typeof rawJob.error === 'string' ? rawJob.error : null,
      createdAt: typeof rawJob.createdAt === 'number' ? rawJob.createdAt : Date.now(),
      startedAt: typeof rawJob.startedAt === 'number' ? rawJob.startedAt : null,
      completedAt: typeof rawJob.completedAt === 'number' ? rawJob.completedAt : null
    }
  } catch {
    return null
  }
}

export function loadQueue(): TranscriptionJob[] {
  const queuePath = getQueuePath()
  if (!existsSync(queuePath)) {
    return []
  }

  const persisted = readVersionedJson<unknown[]>({
    filePath: queuePath,
    schemaVersion: QUEUE_SCHEMA_VERSION,
    validate: Array.isArray,
    migrateLegacy: (legacy) => {
      if (!Array.isArray(legacy)) {
        throw new Error('Legacy queue data must be an array.')
      }
      return legacy
    }
  }).data

  return persisted.map((rawJob, index) => {
    if (!rawJob || typeof rawJob !== 'object') {
      throw new PersistenceError(`Queue job ${index} is not an object.`, queuePath)
    }
    const hydrated = hydrateQueueJob(rawJob as Partial<TranscriptionJob>)
    if (!hydrated) {
      throw new PersistenceError(`Queue job ${index} failed validation.`, queuePath)
    }
    return hydrated
  })
}

export function persistQueue(nextJobs: TranscriptionJob[]): void {
  writeVersionedJson(getQueuePath(), QUEUE_SCHEMA_VERSION, nextJobs)
}

export function setQueueWindow(browserWindow: BrowserWindow): void {
  win = browserWindow
  broadcast()
}

export function requestCancel(): void {
  cancelRequested = true
  pauseRequested = false
  activeDownloadAbortController?.abort()
}

function requestPause(): void {
  pauseRequested = true
  cancelRequested = true
  activeDownloadAbortController?.abort()
}

function broadcast(): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.QUEUE_UPDATED, jobs)
  }
}

function saveAndBroadcast(): void {
  persistQueue(jobs)
  broadcast()
}

function getTempDir(jobId: string): string {
  return join(app.getPath('userData'), 'temp', jobId)
}

function cleanTempDir(jobId: string): void {
  const dir = getTempDir(jobId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function sanitizeFileNamePart(value: string): string {
  const sanitized = value
    .replace(/\.(m4b|mp3|m4a|wav|flac|ogg|aac)$/i, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/./g, (char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return sanitized || 'transcript'
}

function getJobSubtitleBaseName(job: TranscriptionJob): string {
  if (job.source === 'local' && job.audioFiles.length === 1) {
    const firstAudio = basename(job.audioFiles[0], extname(job.audioFiles[0]))
    return sanitizeFileNamePart(firstAudio)
  }

  return sanitizeFileNamePart(job.title)
}

function saveSubtitleFormats(
  sourceSrtPath: string,
  destDir: string,
  baseName: string,
  formats: SubtitleFormat[]
): string[] {
  mkdirSync(destDir, { recursive: true })
  const mergedSrt = readFileSync(sourceSrtPath, 'utf-8')
  const savedPaths = formats.map((format) => {
    const destPath = join(destDir, `${baseName}.${format}`)
    writeFileSync(destPath, convertSrtToFormat(mergedSrt, format), 'utf-8')
    return destPath
  })

  if (!savedPaths.includes(sourceSrtPath)) {
    rmSync(sourceSrtPath, { force: true })
  }

  return savedPaths
}

async function saveMultipartLocalSubtitles(
  sourceSrtPath: string,
  audioFiles: string[],
  outputDir: string,
  formats: SubtitleFormat[]
): Promise<string[]> {
  mkdirSync(outputDir, { recursive: true })

  const mergedSrt = readFileSync(sourceSrtPath, 'utf-8')
  const probeResults = await Promise.all(audioFiles.map((audioFile) => probeFile(audioFile)))
  const splitSrts = splitSrtByDurations(
    mergedSrt,
    probeResults.map((result) => result.duration)
  )

  const savedPaths = audioFiles.flatMap((audioFile, index) => {
    const baseName = basename(audioFile, extname(audioFile))
    const partSrt = splitSrts[index] ?? ''
    return formats.map((format) => {
      const destPath = join(outputDir, `${sanitizeFileNamePart(baseName)}.${format}`)
      writeFileSync(destPath, convertSrtToFormat(partSrt, format), 'utf-8')
      return destPath
    })
  })

  rmSync(sourceSrtPath, { force: true })
  return savedPaths
}

export async function extractEpubVocab(epubPath: string): Promise<string> {
  try {
    const epub = await Epub.createAsync(epubPath)
    const chapters = await Promise.all(epub.flow.map((chapter) => epub.getChapterAsync(chapter.id)))
    const allText = chapters.join(' ')
    const text = allText.replace(/<[^>]+>/g, ' ')
    const words = new Set<string>()

    for (const match of text.matchAll(/\b([A-Z][a-zA-Z]{5,})\b/g)) {
      words.add(match[1])
      if (words.size >= 150) break
    }

    return Array.from(words).join(', ')
  } catch {
    return ''
  }
}

async function resolveAbsAudioPaths(job: TranscriptionJob): Promise<{
  audioPaths: string[]
  baseUrl: string
  apiKey: string
  ebookPath: string | null
  uploadWarning: string | null
}> {
  if (!job.absItemId) {
    throw new Error('AudioBookShelf jobs require an item id.')
  }

  const settings = loadSettings()
  const validation = validateAbsUrl(settings.absUrl)
  if (!validation.ok) {
    throw new Error(validation.error)
  }

  const baseUrl = validation.normalizedUrl
  const apiKey = await resolveAbsAccessToken(baseUrl)
  if (!apiKey) {
    throw new Error('Sign in to Audiobookshelf in Settings first.')
  }
  const book = await fetchAbsBook(baseUrl, apiKey, job.absItemId)
  const audioPaths = buildAbsAudioPaths(baseUrl, book)

  if (audioPaths.length === 0) {
    throw new Error('The selected AudioBookShelf item does not have any audio files.')
  }

  for (const audioPath of audioPaths) {
    if (
      (audioPath.startsWith('http://') || audioPath.startsWith('https://')) &&
      !isSameUrlOrigin(audioPath, baseUrl)
    ) {
      throw new Error('AudioBookShelf audio files must resolve to the configured server origin.')
    }
  }

  return {
    audioPaths,
    baseUrl,
    apiKey,
    ebookPath: book.ebookPath ?? null,
    uploadWarning: book.isFile
      ? 'ABS upload preflight failed because this item is stored as a single file. The subtitle will be saved locally instead.'
      : !book.libraryId || !book.folderId
        ? 'ABS upload preflight could not confirm the library folder. The subtitle will be saved locally instead.'
        : null
  }
}

async function runNext(): Promise<void> {
  if (activeJobId) return

  const next = jobs.find((job) => job.status === 'queued')
  if (!next) return

  activeJobId = next.id
  cancelRequested = false
  pauseRequested = false
  next.status = 'running'
  next.progress = null
  next.error = null
  next.srtPath = null
  next.srtPaths = []
  next.qualityReport = null
  next.startedAt = Date.now()
  saveAndBroadcast()

  try {
    let audioPaths = next.audioFiles
    let absBaseUrl: string | null = null
    let absApiKey: string | null = null
    let absUploadWarning: string | null = null

    if (next.source === 'abs') {
      const resolvedAbs = await resolveAbsAudioPaths(next)
      audioPaths = resolvedAbs.audioPaths
      absBaseUrl = resolvedAbs.baseUrl
      absApiKey = resolvedAbs.apiKey
      next.epubPath = resolvedAbs.ebookPath ?? next.epubPath
      absUploadWarning = resolvedAbs.uploadWarning
    }

    if (!audioPaths || audioPaths.length === 0) {
      throw new Error('No audio files specified for this job.')
    }

    if (next.source === 'abs' && next.absItemId) {
      const tempDir = getTempDir(next.id)
      mkdirSync(tempDir, { recursive: true })
      const downloadAbortController = new AbortController()
      activeDownloadAbortController = downloadAbortController

      const downloadedPaths: string[] = []
      for (const audioPath of audioPaths) {
        if (cancelRequested) {
          throw new Error('Cancelled')
        }

        if (audioPath.startsWith('http://') || audioPath.startsWith('https://')) {
          const urlPath = new URL(audioPath).pathname
          const fileExt = extname(urlPath) || '.tmp'
          const filename = `audio_${downloadedPaths.length}${fileExt}`
          const dest = join(tempDir, filename)
          const headers =
            absBaseUrl && absApiKey && isSameUrlOrigin(audioPath, absBaseUrl)
              ? { Authorization: `Bearer ${absApiKey}` }
              : undefined

          const response = await axios.get(audioPath, {
            responseType: 'stream',
            headers,
            maxRedirects: headers ? 0 : 5,
            signal: downloadAbortController.signal
          })

          await new Promise<void>((resolve, reject) => {
            const writer = createWriteStream(dest)
            const onAbort = (): void => {
              response.data.destroy(new Error('Cancelled'))
              writer.destroy(new Error('Cancelled'))
              rmSync(dest, { force: true })
              reject(new Error('Cancelled'))
            }

            downloadAbortController.signal.addEventListener('abort', onAbort, { once: true })

            response.data.pipe(writer)
            response.data.on('error', (error: Error) => {
              downloadAbortController.signal.removeEventListener('abort', onAbort)
              rmSync(dest, { force: true })
              reject(error)
            })
            writer.on('finish', () => {
              downloadAbortController.signal.removeEventListener('abort', onAbort)
              if (downloadAbortController.signal.aborted) {
                rmSync(dest, { force: true })
                reject(new Error('Cancelled'))
                return
              }

              resolve()
            })
            writer.on('error', (error) => {
              downloadAbortController.signal.removeEventListener('abort', onAbort)
              rmSync(dest, { force: true })
              reject(error)
            })
          })

          downloadedPaths.push(dest)
          continue
        }

        downloadedPaths.push(audioPath)
      }

      audioPaths = downloadedPaths
    }

    activeDownloadAbortController = null

    const progressPlan = createJobProgressPlan({
      needsBinary: !isBinaryDownloaded(),
      needsModel: !isModelDownloaded(next.model),
      needsUpload: next.source === 'abs' && Boolean(next.absItemId)
    })

    const emitProgress = (progress: Omit<WhisperProgressEvent, 'jobId'>): void => {
      if (cancelRequested) return

      const event = mapOverallProgressEvent(progressPlan, { ...progress, jobId: next.id })
      const job = jobs.find((jobItem) => jobItem.id === next.id)
      if (job) {
        job.progress = event
        broadcast()
      }

      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.WHISPER_PROGRESS, event)
      }
    }

    let promptText: string | undefined
    if (next.epubPath) {
      promptText = await extractEpubVocab(next.epubPath)
    }

    const srtPath = await transcribeAudio(
      (progress) => {
        emitProgress(progress)
      },
      audioPaths,
      next.model,
      promptText || undefined,
      { checkpointKey: next.id }
    )

    if (cancelRequested) {
      throw new Error('Cancelled')
    }

    const mergedSrt = readFileSync(srtPath, 'utf-8')
    const qualityDuration = await sumDurations(audioPaths).catch(() => 0)
    next.qualityReport = createQualityReport(parseSrtContent(mergedSrt), qualityDuration)
    const subtitleFormats = next.subtitleFormats ?? ['srt']

    if (next.source === 'abs' && next.absItemId) {
      if (!absBaseUrl || !absApiKey) {
        throw new Error('ABS upload requires a validated server URL and signed-in session.')
      }

      try {
        if (absUploadWarning) {
          throw new Error(absUploadWarning)
        }

        emitProgress({ phase: 'uploading', percent: 0 })
        await uploadSubtitleToAbs(
          absBaseUrl,
          absApiKey,
          next.absItemId,
          srtPath,
          subtitleFormats,
          (percent) => emitProgress({ phase: 'uploading', percent })
        )
        rmSync(srtPath, { force: true })
        next.srtPath = null
        next.srtPaths = []
      } catch {
        next.srtPaths = saveSubtitleFormats(
          srtPath,
          join(app.getPath('userData'), 'srt'),
          getJobSubtitleBaseName(next),
          subtitleFormats
        )
        for (const resultPath of next.srtPaths) {
          trackDesktopManagedArtifact(
            resultPath,
            'result',
            Date.now() + MANAGED_RESULT_RETENTION_MS
          )
        }
        next.srtPath = next.srtPaths.find((path) => extname(path).toLowerCase() === '.srt') ?? null
        next.qualityReport = createQualityReport(parseSrtContent(mergedSrt), qualityDuration, [
          {
            severity: 'warning',
            code: 'upload-fallback',
            message:
              absUploadWarning ?? 'AudioBookShelf upload failed, so the subtitle was saved locally.'
          }
        ])
      }
    } else if (next.outputPath) {
      if (next.audioFiles.length > 1) {
        next.srtPaths = await saveMultipartLocalSubtitles(
          srtPath,
          next.audioFiles,
          next.outputPath,
          subtitleFormats
        )
      } else {
        next.srtPaths = saveSubtitleFormats(
          srtPath,
          next.outputPath,
          getJobSubtitleBaseName(next),
          subtitleFormats
        )
      }
      next.srtPath = next.srtPaths.find((path) => extname(path).toLowerCase() === '.srt') ?? null
    } else {
      next.srtPath = srtPath
      next.srtPaths = [srtPath]
    }

    next.status = 'done'
    next.completedAt = Date.now()
    clearTranscriptionCheckpoint(next.id)
  } catch (error) {
    const isCancelled = cancelRequested || (error instanceof Error && error.message === 'Cancelled')

    if (pauseRequested) {
      next.status = 'paused'
      next.startedAt = null
    } else if (isCancelled) {
      next.status = 'cancelled'
      clearTranscriptionCheckpoint(next.id)
    } else {
      next.status = 'failed'
      next.error = error instanceof Error ? error.message : String(error)
    }

    next.completedAt = Date.now()
  } finally {
    if (next.source === 'abs') {
      cleanTempDir(next.id)
    }

    activeDownloadAbortController = null
    activeJobId = null
    pauseRequested = false
    saveAndBroadcast()
    void runNext()
  }
}

export function registerQueueIpc(): void {
  if (queueIpcRegistered) {
    return
  }

  queueIpcRegistered = true

  jobs = loadQueue()
  let recoveredInterruptedJob = false
  for (const job of jobs) {
    if (job.status === 'running') {
      job.status = 'queued'
      job.startedAt = null
      recoveredInterruptedJob = true
      if (job.source === 'abs') {
        cleanTempDir(job.id)
      }
    }
  }
  if (recoveredInterruptedJob) {
    persistQueue(jobs)
  }

  ipcMain.handle(IPC.QUEUE_ADD, async (_event, jobData: QueueAddPayload) => {
    const payload = sanitizeQueueAddPayload(jobData)
    const job: TranscriptionJob = {
      ...payload,
      id: uuidv4(),
      status: 'queued',
      progress: null,
      srtPath: null,
      srtPaths: [],
      qualityReport: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null
    }

    jobs.push(job)
    saveAndBroadcast()
    void runNext()
    return job
  })

  ipcMain.handle(IPC.QUEUE_REMOVE, (_event, jobId: string) => {
    if (!isNonEmptyString(jobId)) {
      throw new Error('Invalid job id.')
    }

    if (jobId === activeJobId) {
      requestCancel()
      cancelTranscription()
    }

    clearTranscriptionCheckpoint(jobId)
    jobs = jobs.filter((job) => job.id !== jobId)
    saveAndBroadcast()
  })

  ipcMain.handle(IPC.QUEUE_REORDER, (_event, orderedIds: string[]) => {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
      throw new Error('Invalid queue order.')
    }

    const jobMap = new Map(jobs.map((job) => [job.id, job]))
    const reordered = orderedIds
      .map((id) => jobMap.get(id))
      .filter((job): job is TranscriptionJob => Boolean(job))
    const untouched = jobs.filter((job) => !orderedIds.includes(job.id))
    jobs = [...reordered, ...untouched]
    saveAndBroadcast()
  })

  ipcMain.handle(IPC.QUEUE_CANCEL, (_event, jobId: string) => {
    if (!isNonEmptyString(jobId)) {
      throw new Error('Invalid job id.')
    }

    const job = jobs.find((jobItem) => jobItem.id === jobId)
    if (!job) return

    if (job.id === activeJobId) {
      requestCancel()
      cancelTranscription()
    } else if (job.status === 'queued') {
      job.status = 'cancelled'
      job.completedAt = Date.now()
      saveAndBroadcast()
    }
  })

  ipcMain.handle(IPC.QUEUE_PAUSE, (_event, jobId: string) => {
    if (!isNonEmptyString(jobId)) {
      throw new Error('Invalid job id.')
    }

    const job = jobs.find((jobItem) => jobItem.id === jobId)
    if (!job) return

    if (job.id === activeJobId) {
      requestPause()
      cancelTranscription()
    } else if (job.status === 'queued') {
      job.status = 'paused'
      saveAndBroadcast()
    }
  })

  ipcMain.handle(IPC.QUEUE_RESUME, (_event, jobId: string) => {
    if (!isNonEmptyString(jobId)) {
      throw new Error('Invalid job id.')
    }

    const job = jobs.find((jobItem) => jobItem.id === jobId)
    if (!job || job.status !== 'paused') return

    job.status = 'queued'
    job.error = null
    job.completedAt = null
    saveAndBroadcast()
    void runNext()
  })

  ipcMain.handle(
    IPC.QUEUE_RETRY,
    (_event, payload: { jobId?: string; model?: WhisperModel } | string) => {
      const jobId = typeof payload === 'string' ? payload : payload?.jobId
      const model = typeof payload === 'string' ? undefined : payload?.model
      if (!isNonEmptyString(jobId)) {
        throw new Error('Invalid job id.')
      }

      const original = jobs.find((jobItem) => jobItem.id === jobId)
      if (!original) {
        throw new Error('Job not found.')
      }

      const job: TranscriptionJob = {
        ...original,
        id: uuidv4(),
        model: model ? sanitizeModel(model) : original.model,
        status: 'queued',
        progress: null,
        srtPath: null,
        srtPaths: [],
        qualityReport: null,
        error: null,
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null
      }

      jobs.push(job)
      saveAndBroadcast()
      void runNext()
      return job
    }
  )

  ipcMain.handle(IPC.QUEUE_GET_ALL, () => {
    return jobs
  })

  ipcMain.handle(IPC.QUEUE_CLEAR_DONE, () => {
    for (const job of jobs) {
      if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
        clearTranscriptionCheckpoint(job.id)
      }
    }
    jobs = jobs.filter(
      (job) => job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled'
    )
    saveAndBroadcast()
  })

  void runNext()
}
