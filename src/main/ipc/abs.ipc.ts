import { ipcMain } from 'electron'
import axios from 'axios'
import FormData from 'form-data'
import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import {
  clearAbsSession,
  loadAbsSession,
  loadSettings,
  saveAbsLoginProfile,
  saveAbsSession
} from './settings.ipc'
import { splitSrtByDurations } from '../whisper/segments'
import { convertSrtToFormat, getSubtitleMimeType } from '../whisper/subtitleFormats'
import { IPC } from '../../shared/types'
import { validateAbsUrl } from '../../shared/urlSafety'
import type {
  AbsLibrary,
  AbsBook,
  AbsAudioFile,
  AbsLoginResult,
  SubtitleFormat
} from '../../shared/types'

interface AbsLoginResponse {
  user?: {
    username?: string
    type?: string
    token?: string
    accessToken?: string
    refreshToken?: string
  }
  serverSettings?: { version?: string }
}

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
    ebookFile?: { ino?: string; metadata?: { path?: string } } | null
    tracks?: AbsApiTrack[]
  }
}

async function getBaseUrlAndKey(): Promise<{ baseUrl: string; apiKey: string }> {
  const settings = loadSettings()
  const validation = validateAbsUrl(settings.absUrl)
  if (!validation.ok) throw new Error(validation.error)
  const baseUrl = validation.normalizedUrl
  const apiKey = await resolveAbsAccessToken(baseUrl)
  if (!apiKey) throw new Error('Sign in to Audiobookshelf in Settings first.')
  return { baseUrl, apiKey }
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

export async function loginToAbs(
  baseUrlInput: string,
  usernameInput: string,
  password: string
): Promise<AbsLoginResult> {
  if (
    typeof baseUrlInput !== 'string' ||
    typeof usernameInput !== 'string' ||
    typeof password !== 'string'
  ) {
    throw new Error('Enter a valid server URL, username, and password.')
  }
  const validation = validateAbsUrl(baseUrlInput)
  if (!validation.ok) throw new Error(validation.error)
  const username = usernameInput.trim()
  if (!username) throw new Error('Enter your Audiobookshelf username.')
  if (username.length > 200 || password.length > 1024) {
    throw new Error('Audiobookshelf login details are too long.')
  }

  let response
  try {
    response = await axios.post<AbsLoginResponse>(
      `${validation.normalizedUrl}/login`,
      { username, password },
      {
        headers: { Accept: 'application/json', 'x-return-tokens': 'true' },
        timeout: 8000,
        maxRedirects: 0
      }
    )
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      throw new Error('Incorrect Audiobookshelf username or password.')
    }
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      throw new Error('Audiobookshelf login timed out.')
    }
    throw new Error('Could not reach the configured Audiobookshelf server.')
  }

  const user = response.data.user
  const accessToken = user?.accessToken ?? user?.token
  if (!accessToken || !user?.username) {
    throw new Error('Audiobookshelf returned an invalid login response.')
  }

  await saveAbsSession({
    baseUrl: validation.normalizedUrl,
    accessToken,
    ...(user.refreshToken ? { refreshToken: user.refreshToken } : {})
  })
  saveAbsLoginProfile(validation.normalizedUrl, user.username)

  return {
    username: user.username,
    userType: user.type ?? 'user',
    serverVersion: response.data.serverSettings?.version ?? 'unknown',
    ...(new URL(validation.normalizedUrl).protocol === 'http:'
      ? {
          connectionWarning:
            'This private-network Audiobookshelf connection uses HTTP. Credentials and tokens are not encrypted in transit.'
        }
      : {})
  }
}

export async function resolveAbsAccessToken(baseUrl: string): Promise<string | null> {
  const session = await loadAbsSession()
  if (!session) return null
  if (session.baseUrl !== baseUrl) return null
  if (!session.refreshToken) return session.accessToken

  try {
    await axios.post(`${baseUrl}/api/authorize`, null, {
      headers: authHeaders(session.accessToken),
      timeout: 8000,
      maxRedirects: 0
    })
    return session.accessToken
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) return session.accessToken
  }

  try {
    const response = await axios.post<AbsLoginResponse>(`${baseUrl}/auth/refresh`, null, {
      headers: { 'x-refresh-token': session.refreshToken },
      timeout: 8000,
      maxRedirects: 0
    })
    const accessToken = response.data.user?.accessToken
    if (!accessToken) return null
    await saveAbsSession({
      baseUrl,
      accessToken,
      refreshToken: response.data.user?.refreshToken ?? session.refreshToken
    })
    return accessToken
  } catch {
    return null
  }
}

export async function logoutFromAbs(): Promise<void> {
  const session = await loadAbsSession()
  try {
    if (session) {
      await axios.post(`${session.baseUrl}/logout`, null, {
        headers: {
          ...authHeaders(session.accessToken),
          ...(session.refreshToken ? { 'x-refresh-token': session.refreshToken } : {})
        },
        timeout: 5000,
        maxRedirects: 0
      })
    }
  } catch {
    // Local sign-out must still succeed if the server is offline or does not support logout.
  } finally {
    await clearAbsSession()
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

  const audioFiles: AbsAudioFile[] = [...(media.audioFiles ?? [])]
    .sort((a, b) => a.index - b.index)
    .map((file) => ({
      index: file.index,
      ino: file.ino,
      contentUrl:
        trackContentUrlByPath.get(file.metadata.path) ??
        trackContentUrlByIndex.get(file.index) ??
        null,
      metadata: file.metadata,
      duration: file.duration,
      mimeType: file.mimeType,
      addedAt: file.addedAt,
      updatedAt: file.updatedAt
    }))

  const hasSubtitles = (item.libraryFiles ?? []).some(isSubtitleFile)
  const coverPath = media.coverPath ? `${baseUrl}/api/items/${item.id}/cover` : null
  const ebookPath = media.ebookFile?.metadata?.path ?? null
  const ebookDownloadUrl = media.ebookFile?.ino
    ? `${baseUrl}/api/items/${item.id}/file/${media.ebookFile.ino}/download`
    : null

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
    ebookDownloadUrl,
    audioFiles
  }
}

export async function fetchAbsBook(
  baseUrl: string,
  apiKey: string,
  itemId: string
): Promise<AbsBook> {
  const res = await axios.get<AbsApiItem>(`${baseUrl}/api/items/${itemId}?expanded=1`, {
    headers: authHeaders(apiKey),
    maxRedirects: 0
  })
  return mapAbsItemToBook(res.data, baseUrl)
}

export function buildAbsAudioPaths(
  baseUrl: string,
  book: Pick<AbsBook, 'id' | 'audioFiles'>
): string[] {
  return book.audioFiles.map((audioFile) => {
    if (audioFile.contentUrl) {
      return new URL(audioFile.contentUrl, `${baseUrl}/`).toString()
    }

    return `${baseUrl}/api/items/${book.id}/file/${audioFile.ino}/download`
  })
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

function getAudioSubtitleBaseName(
  audioFile: AbsAudioFile | undefined,
  fallbackTitle: string
): string {
  const baseName = audioFile?.metadata?.filename
    ? basename(audioFile.metadata.filename, extname(audioFile.metadata.filename))
    : fallbackTitle

  return sanitizeFileNamePart(baseName)
}

function buildSubtitleUploads(
  book: AbsBook,
  mergedSrt: string,
  fallbackTitle: string,
  formats: SubtitleFormat[]
): Array<{ filename: string; content: string; contentType: string }> {
  const orderedAudioFiles = [...book.audioFiles].sort((a, b) => a.index - b.index)
  const parts =
    orderedAudioFiles.length <= 1
      ? [{ audioFile: orderedAudioFiles[0], srt: mergedSrt }]
      : splitSrtByDurations(
          mergedSrt,
          orderedAudioFiles.map((audioFile) => audioFile.duration)
        ).map((srt, index) => ({ audioFile: orderedAudioFiles[index], srt }))

  return parts.flatMap(({ audioFile, srt }) => {
    if (!srt.trim()) return []
    const baseName = getAudioSubtitleBaseName(audioFile, fallbackTitle)
    return formats.map((format) => ({
      filename: `${baseName}.${format}`,
      content: convertSrtToFormat(srt, format),
      contentType: getSubtitleMimeType(format)
    }))
  })
}

async function postSubtitleUpload(
  url: string,
  apiKey: string,
  uploadFields: ReturnType<typeof getUploadFields>,
  filename: string,
  content: string,
  contentType: string
): Promise<void> {
  const form = new FormData()
  form.append('library', uploadFields.libraryId)
  form.append('folder', uploadFields.folderId)
  form.append('title', uploadFields.title)
  if (uploadFields.author) {
    form.append('author', uploadFields.author)
  }
  if (uploadFields.series) {
    form.append('series', uploadFields.series)
  }
  form.append('0', Buffer.from(content, 'utf-8'), {
    filename,
    contentType
  })

  await axios.post(url, form, {
    headers: {
      ...authHeaders(apiKey),
      ...form.getHeaders()
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    maxRedirects: 0
  })
}

export async function uploadSubtitleToAbs(
  baseUrl: string,
  apiKey: string,
  itemId: string,
  srtPath: string,
  formats: SubtitleFormat[],
  onProgress?: (percent: number) => void
): Promise<void> {
  const book = await fetchAbsBook(baseUrl, apiKey, itemId)
  const uploadFields = getUploadFields(book)
  const url = `${baseUrl}/api/upload`
  const mergedSrt = readFileSync(srtPath, 'utf-8')
  const uploads = buildSubtitleUploads(book, mergedSrt, uploadFields.title || book.title, formats)

  if (uploads.length === 0) {
    throw new Error('No subtitle text was available to upload to ABS.')
  }

  try {
    onProgress?.(0)

    for (const [index, upload] of uploads.entries()) {
      await postSubtitleUpload(
        url,
        apiKey,
        uploadFields,
        upload.filename,
        upload.content,
        upload.contentType
      )
      onProgress?.(Math.round(((index + 1) / (uploads.length + 1)) * 85))
    }

    await axios.post(`${baseUrl}/api/items/${itemId}/scan`, null, {
      headers: authHeaders(apiKey),
      maxRedirects: 0
    })
    onProgress?.(100)
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new Error(
        `Subtitle upload failed (HTTP ${err.response.status}) - ${url}: ${String(err.response.data ?? '')}`
      )
    }
    throw err
  }
}

export function registerAbsIpc(): void {
  ipcMain.handle(IPC.ABS_LOGIN, (_event, url: string, username: string, password: string) =>
    loginToAbs(url, username, password)
  )

  ipcMain.handle(IPC.ABS_LOGOUT, async () => {
    await logoutFromAbs()
  })

  ipcMain.handle(IPC.ABS_GET_LIBRARIES, async () => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    const res = await axios.get<{ libraries: AbsApiLibrary[] }>(`${baseUrl}/api/libraries`, {
      headers: authHeaders(apiKey),
      maxRedirects: 0
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
      { headers: authHeaders(apiKey), maxRedirects: 0 }
    )
    return fetchAbsBooksWithDetails(baseUrl, apiKey, res.data.results)
  })

  ipcMain.handle(IPC.ABS_GET_BOOK, async (_event, itemId: string) => {
    const { baseUrl, apiKey } = await getBaseUrlAndKey()
    return fetchAbsBook(baseUrl, apiKey, itemId)
  })
}
