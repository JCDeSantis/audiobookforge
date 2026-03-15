import { ipcMain, app } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import Epub from 'epub2'
import { transcribeAudio } from '../whisper/transcribe'
import { uploadSubtitleToAbs } from './abs.ipc'
import { loadApiKey, loadSettings } from './settings.ipc'
import { IPC } from '../../shared/types'
import type { TranscriptionJob, WhisperProgressEvent } from '../../shared/types'

// ─── Persistence ──────────────────────────────────────────────────────────────

function getQueuePath(): string {
  return join(app.getPath('userData'), 'queue.json')
}

export function loadQueue(): TranscriptionJob[] {
  try {
    const raw = readFileSync(getQueuePath(), 'utf-8')
    return JSON.parse(raw) as TranscriptionJob[]
  } catch {
    return []
  }
}

export function persistQueue(jobs: TranscriptionJob[]): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(getQueuePath(), JSON.stringify(jobs, null, 2), 'utf-8')
}

// ─── In-memory state ──────────────────────────────────────────────────────────

let jobs: TranscriptionJob[] = []
let activeJobId: string | null = null
let cancelRequested = false
let win: BrowserWindow | null = null

export function requestCancel(): void {
  cancelRequested = true
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

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

// ─── EPUB vocab extraction ────────────────────────────────────────────────────

export async function extractEpubVocab(epubPath: string): Promise<string> {
  try {
    const epub = await Epub.createAsync(epubPath)
    const chapters = await Promise.all(
      epub.flow.map((chapter) => epub.getChapterAsync(chapter.id))
    )
    const allText = chapters.join(' ')
    // Strip HTML tags
    const text = allText.replace(/<[^>]+>/g, ' ')
    // Extract unique capitalized words 6+ chars, max 150
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

// ─── Queue execution ──────────────────────────────────────────────────────────

async function runNext(): Promise<void> {
  if (activeJobId) return
  const next = jobs.find((j) => j.status === 'queued')
  if (!next) return

  activeJobId = next.id
  cancelRequested = false
  next.status = 'running'
  next.progress = null
  saveAndBroadcast()

  try {
    // For remote ABS jobs: download audio first
    let audioPaths = next.audioFiles
    if (next.source === 'abs' && next.absItemId) {
      const settings = loadSettings()
      const baseUrl = settings.absUrl.replace(/\/$/, '')
      const apiKey = await loadApiKey()

      if (apiKey && baseUrl) {
        const tempDir = getTempDir(next.id)
        mkdirSync(tempDir, { recursive: true })

        // Build download paths for each audio file
        const downloadedPaths: string[] = []
        for (const af of next.audioFiles) {
          // af is absolute path for same-machine ABS; URL for remote
          // If it starts with http, download it
          if (af.startsWith('http')) {
            const filename = `audio_${downloadedPaths.length}.tmp`
            const dest = join(tempDir, filename)
            const axios = (await import('axios')).default
            const res = await axios.get(af, {
              responseType: 'stream',
              headers: { Authorization: `Bearer ${apiKey}` }
            })
            await new Promise<void>((resolve, reject) => {
              const { createWriteStream } = await import('fs')
              const writer = createWriteStream(dest)
              res.data.pipe(writer)
              writer.on('finish', resolve)
              writer.on('error', reject)
            })
            downloadedPaths.push(dest)
          } else {
            downloadedPaths.push(af)
          }
        }
        audioPaths = downloadedPaths
      }
    }

    // Extract EPUB vocab if available
    let promptText: string | undefined
    if (next.epubPath) {
      promptText = await extractEpubVocab(next.epubPath)
    }

    const srtPath = await transcribeAudio(
      (progress) => {
        if (cancelRequested) return
        const event: WhisperProgressEvent = { ...progress, jobId: next.id }
        const job = jobs.find((j) => j.id === next.id)
        if (job) {
          job.progress = event
          // Don't persist on every progress tick — just broadcast
          broadcast()
        }
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.WHISPER_PROGRESS, event)
        }
      },
      audioPaths,
      next.model,
      promptText || undefined
    )

    if (cancelRequested) {
      throw new Error('Cancelled')
    }

    // Handle ABS upload vs local save
    if (next.source === 'abs' && next.absItemId) {
      const settings = loadSettings()
      const baseUrl = settings.absUrl.replace(/\/$/, '')
      const apiKey = await loadApiKey()
      if (apiKey && baseUrl) {
        await uploadSubtitleToAbs(baseUrl, apiKey, next.absItemId, srtPath)
      }
      next.srtPath = null
    } else {
      // Move SRT to output folder
      if (next.outputPath) {
        const { copyFileSync } = await import('fs')
        const { basename } = await import('path')
        const dest = join(next.outputPath, basename(srtPath))
        copyFileSync(srtPath, dest)
        next.srtPath = dest
      } else {
        next.srtPath = srtPath
      }
    }

    next.status = 'done'
    next.completedAt = Date.now()
  } catch (err) {
    const isCancelled =
      cancelRequested || (err instanceof Error && err.message === 'Cancelled')
    if (isCancelled) {
      next.status = 'cancelled'
    } else {
      next.status = 'failed'
      next.error = err instanceof Error ? err.message : String(err)
    }
    next.completedAt = Date.now()
  } finally {
    // Clean up temp dir for ABS jobs
    if (next.source === 'abs') {
      cleanTempDir(next.id)
    }
    activeJobId = null
    saveAndBroadcast()
    // Advance queue
    runNext()
  }
}

// ─── IPC registration ─────────────────────────────────────────────────────────

export function registerQueueIpc(browserWindow: BrowserWindow): void {
  win = browserWindow

  // Load queue and reset any stuck running jobs
  jobs = loadQueue()
  for (const job of jobs) {
    if (job.status === 'running') {
      job.status = 'queued'
      // Clean temp dir for ABS jobs that were interrupted
      if (job.source === 'abs') {
        cleanTempDir(job.id)
      }
    }
  }
  persistQueue(jobs)

  ipcMain.handle(IPC.QUEUE_ADD, async (_event, jobData: Omit<TranscriptionJob, 'id' | 'status' | 'progress' | 'srtPath' | 'error' | 'createdAt' | 'completedAt'>) => {
    const job: TranscriptionJob = {
      ...jobData,
      id: uuidv4(),
      status: 'queued',
      progress: null,
      srtPath: null,
      error: null,
      createdAt: Date.now(),
      completedAt: null
    }
    jobs.push(job)
    saveAndBroadcast()
    runNext()
    return job
  })

  ipcMain.handle(IPC.QUEUE_REMOVE, (_event, jobId: string) => {
    jobs = jobs.filter((j) => j.id !== jobId)
    saveAndBroadcast()
  })

  ipcMain.handle(IPC.QUEUE_REORDER, (_event, orderedIds: string[]) => {
    const jobMap = new Map(jobs.map((j) => [j.id, j]))
    jobs = orderedIds.map((id) => jobMap.get(id)).filter(Boolean) as TranscriptionJob[]
    saveAndBroadcast()
  })

  ipcMain.handle(IPC.QUEUE_CANCEL, (_event, jobId: string) => {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return
    if (job.id === activeJobId) {
      cancelRequested = true
      // cancelTranscription is called via whisper.ipc.ts WHISPER_CANCEL handler
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
    jobs = jobs.filter((j) => j.status !== 'done' && j.status !== 'failed' && j.status !== 'cancelled')
    saveAndBroadcast()
  })
}
