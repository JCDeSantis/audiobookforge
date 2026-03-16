import { ipcMain } from 'electron'
import axios from 'axios'
import FormData from 'form-data'
import { createReadStream } from 'fs'
import { basename, extname } from 'path'
import { loadApiKey, loadSettings } from './settings.ipc'
import { IPC } from '../../shared/types'
import type { AbsLibrary, AbsBook, AbsAudioFile } from '../../shared/types'

// ─── Internal ABS API shapes ─────────────────────────────────────────────────

interface AbsApiLibrary {
  id: string
  name: string
  mediaType: string
}

interface AbsApiAudioFile {
  index: number
  ino: string
  metadata: { filename: string; ext: string; path: string; relPath: string }
  duration: number
  mimeType: string
  addedAt: number
  updatedAt: number
}

interface AbsApiTrack {
  index?: number
  contentUrl?: string
  metadata?: { path?: string }
}

interface AbsApiLibraryFile {
  relPath?: string
  metadata?: { ext?: string }
}

interface AbsApiItem {
  id: string
  libraryId?: string
  folderId?: string
  relPath?: string
  isFile?: boolean
  libraryFiles?: AbsApiLibraryFile[]
  media?: {
    metadata?: { title?: string; authorName?: string }
    duration?: number
    coverPath?: string
    audioFiles?: AbsApiAudioFile[]
    ebookFile?: { metadata?: { path?: string } } | null
    tracks?: AbsApiTrack[]
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getBaseUrlAndKey(): Promise<{ baseUrl: string; apiKey: string }> {
  const settings = loadSettings()
  const baseUrl = settings.absUrl.replace(/\/$/, '')
  const apiKey = await loadApiKey()
  if (!apiKey) throw new Error('ABS API key not configured')
  return { baseUrl, apiKey }
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
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

function isSubtitleFile(file: AbsApiLibraryFile): boolean {
  const ext = (file.metadata?.ext ?? extname(file.relPath ?? '')).toLowerCase()
  return ['.srt', '.vtt', '.lrc', '.ass', '.ssa', '.sub'].includes(ext)
}

export function mapAbsItemToBook(item: AbsApiItem, baseUrl: string): AbsBook {
  const media = item.media ?? {}
  const meta = media.metadata ?? {}
  const trackContentUrlByIndex = new Map<number, string>()
  const trackContentUrlByPath = new Map<string, string>()

  for (const track of media.tracks ?? []) {
    if (typeof track.contentUrl !== 'string' || track.contentUrl.length === 0) {
      continue
    }
    if (typeof track.index === 'number') {
      trackContentUrlByIndex.set(track.index, track.contentUrl)
    }
    if (typeof track.metadata?.path === 'string' && track.metadata.path.length > 0) {
      trackContentUrlByPath.set(track.metadata.path, track.contentUrl)
    }
  }

  const audioFiles: AbsAudioFile[] = (media.audioFiles ?? []).map((f) => ({
    index: f.index,
    ino: f.ino,
    contentUrl:
      trackContentUrlByPath.get(f.metadata.path) ?? trackContentUrlByIndex.get(f.index) ?? null,
    metadata: f.metadata,
    duration: f.duration,
    mimeType: f.mimeType,
    addedAt: f.addedAt,
    updatedAt: f.updatedAt
  }))

  const hasSubtitles = (item.libraryFiles ?? []).some(isSubtitleFile)

  const coverPath = media.coverPath ? `${baseUrl}/api/items/${item.id}/cover` : null

  const ebookFile = media.ebookFile
  const ebookPath = ebookFile?.metadata?.path ?? null

  return {
    id: item.id,
    libraryId: item.libraryId ?? '',
    folderId: item.folderId ?? '',
    relPath: item.relPath ?? '',
    isFile: item.isFile ?? false,
    title: meta.title ?? 'Unknown',
    authorName: meta.authorName ?? 'Unknown',
    duration: media.duration ?? 0,
    cover: coverPath,
    hasSubtitles,
    ebookPath,
    audioFiles
  }
}

export function testAbsConnection(baseUrl: string, apiKey: string): Promise<boolean> {
  return axios
    .get(`${baseUrl}/api/libraries`, { headers: authHeaders(apiKey), timeout: 8000 })
    .then(() => true)
    .catch(() => false)
}

async function fetchAbsBook(baseUrl: string, apiKey: string, itemId: string): Promise<AbsBook> {
  const res = await axios.get<AbsApiItem>(`${baseUrl}/api/items/${itemId}?expanded=1`, {
    headers: authHeaders(apiKey)
  })
  return mapAbsItemToBook(res.data, baseUrl)
}

async function fetchAbsBooksWithDetails(
  baseUrl: string,
  apiKey: string,
  items: AbsApiItem[]
): Promise<AbsBook[]> {
  const books = items.map((item) => mapAbsItemToBook(item, baseUrl))
  const concurrency = Math.min(6, items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++
        const item = items[currentIndex]

        try {
          books[currentIndex] = await fetchAbsBook(baseUrl, apiKey, item.id)
        } catch {
          books[currentIndex] = mapAbsItemToBook(item, baseUrl)
        }
      }
    })
  )

  return books
}

function getUploadFields(book: AbsBook): {
  libraryId: string
  folderId: string
  title: string
  author: string
  series: string
} {
  if (book.isFile) {
    throw new Error(
      'ABS remote subtitle upload currently requires folder-based books. This item is stored as a single file.'
    )
  }

  const segments = book.relPath.split(/[\\/]/).filter(Boolean)
  const title = segments.at(-1) ?? book.title
  const author = segments.length >= 2 ? segments[0] : book.authorName
  const series = segments.length >= 3 ? segments.slice(1, -1).join('/') : ''

  return {
    libraryId: book.libraryId,
    folderId: book.folderId,
    title,
    author,
    series
  }
}

function getSubtitleFileName(book: AbsBook): string {
  const firstAudioName = book.audioFiles[0]?.metadata?.filename
  const baseName = firstAudioName ? basename(firstAudioName, extname(firstAudioName)) : book.title

  return `${sanitizeFileNamePart(baseName)}.srt`
}

export async function uploadSubtitleToAbs(
  baseUrl: string,
  apiKey: string,
  itemId: string,
  srtPath: string
): Promise<void> {
  const book = await fetchAbsBook(baseUrl, apiKey, itemId)
  const uploadFields = getUploadFields(book)
  const url = `${baseUrl}/api/upload`
  const filename = getSubtitleFileName(book)
  const form = new FormData()
  // ABS v2.32.1 exposes /api/upload for library-folder uploads; we target the item's folder.
  form.append('library', uploadFields.libraryId)
  form.append('folder', uploadFields.folderId)
  form.append('title', uploadFields.title)
  if (uploadFields.author) {
    form.append('author', uploadFields.author)
  }
  if (uploadFields.series) {
    form.append('series', uploadFields.series)
  }
  form.append('0', createReadStream(srtPath), { filename, contentType: 'application/x-subrip' })

  try {
    await axios.post(url, form, {
      headers: {
        ...authHeaders(apiKey),
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    })
    // Trigger item rescan so ABS detects the new SRT in its folder
    await axios.post(`${baseUrl}/api/items/${itemId}/scan`, null, {
      headers: authHeaders(apiKey)
    })
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new Error(
        `SRT upload failed (HTTP ${err.response.status}) — ${url}: ${String(err.response.data ?? '')}`
      )
    }
    throw err
  }
}

// ─── IPC registration ─────────────────────────────────────────────────────────

export function registerAbsIpc(): void {
  ipcMain.handle(IPC.ABS_TEST_CONNECTION, async (_event, url: string, key: string) => {
    const baseUrl = url.replace(/\/$/, '')
    return testAbsConnection(baseUrl, key)
  })

  ipcMain.handle(IPC.ABS_GET_LIBRARIES, async () => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    const res = await axios.get<{ libraries: AbsApiLibrary[] }>(`${baseUrl}/api/libraries`, {
      headers: authHeaders(apiKey)
    })
    return res.data.libraries.map<AbsLibrary>((lib) => ({
      id: lib.id,
      name: lib.name,
      mediaType: lib.mediaType
    }))
  })

  ipcMain.handle(IPC.ABS_GET_BOOKS, async (_event, libraryId: string) => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    const res = await axios.get<{ results: AbsApiItem[] }>(
      `${baseUrl}/api/libraries/${libraryId}/items?limit=500&page=0`,
      { headers: authHeaders(apiKey) }
    )
    return fetchAbsBooksWithDetails(baseUrl, apiKey, res.data.results)
  })

  ipcMain.handle(IPC.ABS_GET_BOOK, async (_event, itemId: string) => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    return fetchAbsBook(baseUrl, apiKey, itemId)
  })

  ipcMain.handle(IPC.ABS_UPLOAD_SUBTITLE, async (_event, itemId: string, srtPath: string) => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    await uploadSubtitleToAbs(baseUrl, apiKey, itemId, srtPath)
  })
}
