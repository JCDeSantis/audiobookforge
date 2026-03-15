import { ipcMain } from 'electron'
import axios from 'axios'
import FormData from 'form-data'
import { createReadStream } from 'fs'
import { basename } from 'path'
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

interface AbsApiItem {
  id: string
  media?: {
    metadata?: { title?: string; authorName?: string }
    duration?: number
    coverPath?: string
    audioFiles?: AbsApiAudioFile[]
    ebookFile?: { metadata?: { path?: string } } | null
    tracks?: Array<unknown>
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

export function mapAbsItemToBook(item: AbsApiItem, baseUrl: string): AbsBook {
  const media = item.media ?? {}
  const meta = media.metadata ?? {}
  const audioFiles: AbsAudioFile[] = (media.audioFiles ?? []).map((f) => ({
    index: f.index,
    ino: f.ino,
    metadata: f.metadata,
    duration: f.duration,
    mimeType: f.mimeType,
    addedAt: f.addedAt,
    updatedAt: f.updatedAt
  }))

  const tracks = (media.tracks ?? []) as Array<unknown>
  const hasSubtitles = tracks.length > 0

  const coverPath = media.coverPath
    ? `${baseUrl}/api/items/${item.id}/cover`
    : null

  const ebookFile = media.ebookFile
  const ebookPath = ebookFile?.metadata?.path ?? null

  return {
    id: item.id,
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

export async function uploadSubtitleToAbs(
  baseUrl: string,
  apiKey: string,
  itemId: string,
  srtPath: string
): Promise<void> {
  const url = `${baseUrl}/api/items/${itemId}/upload`
  const filename = basename(srtPath)
  const form = new FormData()
  form.append('files', createReadStream(srtPath), { filename, contentType: 'text/srt' })

  try {
    await axios.post(url, form, {
      headers: {
        ...authHeaders(apiKey),
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    })
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new Error(`SRT upload failed (HTTP ${err.response.status}) — ${url}`)
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
    const res = await axios.get<{ libraries: AbsApiLibrary[] }>(
      `${baseUrl}/api/libraries`,
      { headers: authHeaders(apiKey) }
    )
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
    return res.data.results.map((item) => mapAbsItemToBook(item, baseUrl))
  })

  ipcMain.handle(IPC.ABS_GET_BOOK, async (_event, itemId: string) => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    const res = await axios.get<AbsApiItem>(
      `${baseUrl}/api/items/${itemId}?expanded=1`,
      { headers: authHeaders(apiKey) }
    )
    return mapAbsItemToBook(res.data, baseUrl)
  })

  ipcMain.handle(IPC.ABS_UPLOAD_SUBTITLE, async (_event, itemId: string, srtPath: string) => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    await uploadSubtitleToAbs(baseUrl, apiKey, itemId, srtPath)
  })
}
