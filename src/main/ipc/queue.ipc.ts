import { ipcMain, app } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
  createWriteStream
} from 'fs'
import { join, basename, extname, isAbsolute } from 'path'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import Epub from 'epub2'
import { cancelTranscription, transcribeAudio } from '../whisper/transcribe'
import { isBinaryDownloaded } from '../whisper/binary'
import { isModelDownloaded, WHISPER_MODELS } from '../whisper/models'
import { probeFile } from '../ffmpeg/probe'
import { splitSrtByDurations } from '../whisper/segments'
import { createJobProgressPlan, mapOverallProgressEvent } from '../../shared/jobProgress'
import { buildAbsAudioPaths, fetchAbsBook, uploadSubtitleToAbs } from './abs.ipc'
import { loadApiKey, loadSettings } from './settings.ipc'
import { IPC } from '../../shared/types'
import { isSameUrlOrigin, validateAbsUrl } from '../../shared/urlSafety'
import type { TranscriptionJob, WhisperModel, WhisperProgressEvent } from '../../shared/types'

type QueueAddPayload = Omit<
  TranscriptionJob,
  'id' | 'status' | 'progress' | 'srtPath' | 'srtPaths' | 'error' | 'createdAt' | 'startedAt' | 'completedAt'
>

const VALID_MODELS = new Set<WhisperModel>(WHISPER_MODELS.map((model) => model.id))
const VALID_JOB_STATUSES = new Set<TranscriptionJob['status']>([
  'queued',
  'running',
  'done',
  'failed',
  'cancelled'
])

let jobs: TranscriptionJob[] = []
let activeJobId: string | null = null
let cancelRequested = false
let activeDownloadAbortController: AbortController | null = null
let win: BrowserWindow | null = null
let queueIpcRegistered = false

function getQueuePath(): string {
  return join(app.getPath('userData'), 'queue.json')
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
      model: sanitizeModel(candidate.model)
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
      absAuthorName: isNonEmptyString(candidate.absAuthorName) ? candidate.absAuthorName.trim() : null,
      epubPath: sanitizeOptionalAbsolutePath(candidate.epubPath),
      model: sanitizeModel(candidate.model)
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
        ? rawJob.srtPaths.filter((path): path is string => typeof path === 'string' && isAbsolute(path))
        : [],
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
  try {
    const raw = readFileSync(getQueuePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Array<Partial<TranscriptionJob>>

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((job) => hydrateQueueJob(job))
      .filter((job): job is TranscriptionJob => job !== null)
  } catch {
    return []
  }
}

export function persistQueue(nextJobs: TranscriptionJob[]): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(getQueuePath(), JSON.stringify(nextJobs, null, 2), 'utf-8')
}

export function setQueueWindow(browserWindow: BrowserWindow): void {
  win = browserWindow
  broadcast()
}

export function requestCancel(): void {
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
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return sanitized || 'transcript'
}

function getJobSrtFileName(job: TranscriptionJob): string {
  if (job.source === 'local' && job.audioFiles.length === 1) {
    const firstAudio = basename(job.audioFiles[0], extname(job.audioFiles[0]))
    return `${sanitizeFileNamePart(firstAudio)}.srt`
  }

  return `${sanitizeFileNamePart(job.title)}.srt`
}

function relocateSrtToDir(sourcePath: string, destDir: string, destFileName?: string): string {
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, destFileName ?? basename(sourcePath))

  if (dest === sourcePath) {
    return sourcePath
  }

  copyFileSync(sourcePath, dest)
  rmSync(sourcePath, { force: true })
  return dest
}

async function saveMultipartLocalSrts(
  sourceSrtPath: string,
  audioFiles: string[],
  outputDir: string
): Promise<string[]> {
  mkdirSync(outputDir, { recursive: true })

  const mergedSrt = readFileSync(sourceSrtPath, 'utf-8')
  const probeResults = await Promise.all(audioFiles.map((audioFile) => probeFile(audioFile)))
  const splitSrts = splitSrtByDurations(
    mergedSrt,
    probeResults.map((result) => result.duration)
  )

  const savedPaths = audioFiles.map((audioFile, index) => {
    const baseName = basename(audioFile, extname(audioFile))
    const destPath = join(outputDir, `${sanitizeFileNamePart(baseName)}.srt`)
    writeFileSync(destPath, splitSrts[index] ?? '', 'utf-8')
    return destPath
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
}> {
  if (!job.absItemId) {
    throw new Error('AudioBookShelf jobs require an item id.')
  }

  const settings = loadSettings()
  const validation = validateAbsUrl(settings.absUrl)
  if (!validation.ok) {
    throw new Error(validation.error)
  }

  const apiKey = await loadApiKey()
  if (!apiKey) {
    throw new Error('ABS API key not configured')
  }

  const baseUrl = validation.normalizedUrl
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
    ebookPath: book.ebookPath ?? null
  }
}

async function runNext(): Promise<void> {
  if (activeJobId) return

  const next = jobs.find((job) => job.status === 'queued')
  if (!next) return

  activeJobId = next.id
  cancelRequested = false
  next.status = 'running'
  next.progress = null
  next.error = null
  next.srtPath = null
  next.srtPaths = []
  next.startedAt = Date.now()
  saveAndBroadcast()

  try {
    let audioPaths = next.audioFiles
    let absBaseUrl: string | null = null
    let absApiKey: string | null = null

    if (next.source === 'abs') {
      const resolvedAbs = await resolveAbsAudioPaths(next)
      audioPaths = resolvedAbs.audioPaths
      absBaseUrl = resolvedAbs.baseUrl
      absApiKey = resolvedAbs.apiKey
      next.epubPath = resolvedAbs.ebookPath ?? next.epubPath
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
      promptText || undefined
    )

    if (cancelRequested) {
      throw new Error('Cancelled')
    }

    if (next.source === 'abs' && next.absItemId) {
      if (!absBaseUrl || !absApiKey) {
        throw new Error('ABS upload requires a validated server URL and API key.')
      }

      try {
        emitProgress({ phase: 'uploading', percent: 0 })
        await uploadSubtitleToAbs(absBaseUrl, absApiKey, next.absItemId, srtPath, (percent) => {
          emitProgress({ phase: 'uploading', percent })
        })
        rmSync(srtPath, { force: true })
        next.srtPath = null
        next.srtPaths = []
      } catch {
        next.srtPath = relocateSrtToDir(
          srtPath,
          join(app.getPath('userData'), 'srt'),
          getJobSrtFileName(next)
        )
        next.srtPaths = next.srtPath ? [next.srtPath] : []
      }
    } else if (next.outputPath) {
      if (next.audioFiles.length > 1) {
        next.srtPaths = await saveMultipartLocalSrts(srtPath, next.audioFiles, next.outputPath)
        next.srtPath = next.srtPaths[0] ?? null
      } else {
        next.srtPath = relocateSrtToDir(srtPath, next.outputPath, getJobSrtFileName(next))
        next.srtPaths = next.srtPath ? [next.srtPath] : []
      }
    } else {
      next.srtPath = srtPath
      next.srtPaths = [srtPath]
    }

    next.status = 'done'
    next.completedAt = Date.now()
  } catch (error) {
    const isCancelled =
      cancelRequested || (error instanceof Error && error.message === 'Cancelled')

    if (isCancelled) {
      next.status = 'cancelled'
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
  for (const job of jobs) {
    if (job.status === 'running') {
      job.status = 'queued'
      job.startedAt = null
      if (job.source === 'abs') {
        cleanTempDir(job.id)
      }
    }
  }
  persistQueue(jobs)

  ipcMain.handle(IPC.QUEUE_ADD, async (_event, jobData: QueueAddPayload) => {
    const payload = sanitizeQueueAddPayload(jobData)
    const job: TranscriptionJob = {
      ...payload,
      id: uuidv4(),
      status: 'queued',
      progress: null,
      srtPath: null,
      srtPaths: [],
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

  ipcMain.handle(IPC.QUEUE_GET_ALL, () => {
    return jobs
  })

  ipcMain.handle(IPC.QUEUE_CLEAR_DONE, () => {
    jobs = jobs.filter(
      (job) => job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled'
    )
    saveAndBroadcast()
  })
}
