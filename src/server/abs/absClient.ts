import { lookup } from 'dns/promises'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import type { LookupFunction } from 'net'
import { isIP } from 'net'
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { AbsBook, AbsLibrary, AbsLoginResult } from '../../shared/types'
import {
  isBlockedNetworkHostname,
  isPrivateHostname,
  validateAbsUrl
} from '../../shared/urlSafety'
import { mapAbsItemToBook, type AbsApiItem, type AbsApiLibrary } from '../../core/abs/mapping'
import type { ServerAbsSession } from './sessionStore'
import {
  convertSrtToFormat,
  getSubtitleMimeType,
  splitSrtByDurations
} from '../../shared/subtitleFormats'
import type { SubtitleFormat } from '../../shared/types'
import {
  availableBytes,
  DEFAULT_STORAGE_RESERVE_BYTES
} from '../../core/storage/processingSpace'

interface LoginResponse {
  user?: {
    username?: string
    type?: string
    token?: string
    accessToken?: string
    refreshToken?: string
  }
  serverSettings?: { version?: string }
}

async function pinnedAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const answers = await lookup(hostname, { all: true, verbatim: true })
  if (answers.length === 0) throw new Error('Audiobookshelf hostname did not resolve.')
  const privateDestination = isPrivateHostname(hostname)
  for (const answer of answers) {
    if (isBlockedNetworkHostname(answer.address)) {
      throw new Error('Audiobookshelf resolved to a blocked metadata or link-local address.')
    }
    if (!privateDestination && isPrivateHostname(answer.address)) {
      throw new Error('Public Audiobookshelf hostnames cannot resolve to private addresses.')
    }
  }
  const selected = answers[0]
  return { address: selected.address, family: selected.family as 4 | 6 }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`)
  if (url.origin !== new URL(baseUrl).origin) throw new Error('ABS request origin changed unexpectedly.')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const pinned = isIP(hostname)
    ? { address: hostname, family: isIP(hostname) as 4 | 6 }
    : await pinnedAddress(url)
  const body = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body))
  const lookupPinned: LookupFunction = (_hostname, _options, callback) => {
    callback(null, pinned.address, pinned.family)
  }
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<T>((resolveRequest, reject) => {
    const request = transport(
      url,
      {
        method: options.method ?? 'GET',
        lookup: lookupPinned,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...options.headers
        },
        timeout: 10_000
      },
      (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 20 * 1024 * 1024) {
            request.destroy(new Error('Audiobookshelf response exceeded the safety limit.'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const status = response.statusCode ?? 500
          if (status >= 300 && status < 400) {
            reject(new Error('Audiobookshelf redirects are not allowed.'))
            return
          }
          if (status < 200 || status >= 300) {
            reject(new Error(`Audiobookshelf request failed (${status}).`))
            return
          }
          try {
            resolveRequest(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T)
          } catch {
            reject(new Error('Audiobookshelf returned invalid JSON.'))
          }
        })
      }
    )
    request.on('timeout', () => request.destroy(new Error('Audiobookshelf request timed out.')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

export class ServerAbsClient {
  validateBaseUrl(input: string): string {
    const validation = validateAbsUrl(input)
    if (!validation.ok) throw new Error(validation.error)
    return validation.normalizedUrl
  }

  async login(baseUrlInput: string, usernameInput: string, password: string): Promise<{
    session: ServerAbsSession
    result: AbsLoginResult
  }> {
    const baseUrl = this.validateBaseUrl(baseUrlInput)
    const username = usernameInput.trim()
    if (!username || username.length > 200 || password.length > 1024) {
      throw new Error('Enter valid Audiobookshelf login details.')
    }
    const response = await requestJson<LoginResponse>(baseUrl, '/login', {
      method: 'POST',
      body: { username, password },
      headers: { 'x-return-tokens': 'true' }
    })
    const accessToken = response.user?.accessToken ?? response.user?.token
    if (!accessToken || !response.user?.username) {
      throw new Error('Audiobookshelf returned an invalid login response.')
    }
    return {
      session: {
        baseUrl,
        accessToken,
        ...(response.user.refreshToken ? { refreshToken: response.user.refreshToken } : {})
      },
      result: {
        username: response.user.username,
        userType: response.user.type ?? 'user',
        serverVersion: response.serverSettings?.version ?? 'unknown',
        ...(new URL(baseUrl).protocol === 'http:'
          ? { connectionWarning: 'This private-network ABS connection uses unencrypted HTTP.' }
          : {})
      }
    }
  }

  async libraries(session: ServerAbsSession): Promise<AbsLibrary[]> {
    const response = await requestJson<{ libraries: AbsApiLibrary[] }>(
      session.baseUrl,
      '/api/libraries',
      { token: session.accessToken }
    )
    return response.libraries.map((library) => ({
      id: library.id,
      name: library.name,
      mediaType: library.mediaType
    }))
  }

  async books(session: ServerAbsSession, libraryId: string): Promise<AbsBook[]> {
    const response = await requestJson<{ results: AbsApiItem[] }>(
      session.baseUrl,
      `/api/libraries/${encodeURIComponent(libraryId)}/items?limit=500&page=0`,
      { token: session.accessToken }
    )
    return response.results.map((item) => mapAbsItemToBook(item, session.baseUrl))
  }

  async book(session: ServerAbsSession, itemId: string): Promise<AbsBook> {
    const item = await requestJson<AbsApiItem>(
      session.baseUrl,
      `/api/items/${encodeURIComponent(itemId)}?expanded=1`,
      { token: session.accessToken }
    )
    return mapAbsItemToBook(item, session.baseUrl)
  }

  async downloadBookInputs(
    session: ServerAbsSession,
    itemId: string,
    targetDir: string,
    onProgress: (percent: number) => void,
    signal: AbortSignal
  ): Promise<{ book: AbsBook; audioPaths: string[]; epubPath: string | null }> {
    const book = await this.book(session, itemId)
    if (book.audioFiles.length === 0) throw new Error('The ABS item has no downloadable audio files.')
    mkdirSync(targetDir, { recursive: true })
    const audioPaths: string[] = []
    for (const [index, audio] of book.audioFiles.entries()) {
      const sourceUrl = audio.contentUrl
        ? new URL(audio.contentUrl, `${session.baseUrl}/`).toString()
        : `${session.baseUrl}/api/items/${encodeURIComponent(book.id)}/file/${encodeURIComponent(audio.ino)}/download`
      const extension = extname(audio.metadata.filename) || audio.metadata.ext || '.audio'
      const target = join(targetDir, `abs-audio-${String(index).padStart(4, '0')}${extension}`)
      await this.downloadFile(session, sourceUrl, target, 100 * 1024 * 1024 * 1024, signal)
      audioPaths.push(target)
      onProgress(Math.round(((index + 1) / (book.audioFiles.length + 1)) * 90))
    }
    let epubPath: string | null = null
    if (book.ebookDownloadUrl) {
      epubPath = join(targetDir, 'context.epub')
      await this.downloadFile(session, book.ebookDownloadUrl, epubPath, 2 * 1024 * 1024 * 1024, signal)
    }
    onProgress(100)
    return { book, audioPaths, epubPath }
  }

  async uploadSubtitleResults(
    session: ServerAbsSession,
    book: AbsBook,
    resultPaths: string[],
    signal: AbortSignal
  ): Promise<void> {
    if (book.isFile) throw new Error('ABS subtitle upload requires a folder-based book.')
    if (resultPaths.length === 0) throw new Error('No subtitle results were available to upload.')
    if (!book.libraryId || !book.folderId) throw new Error('ABS did not provide upload destination metadata.')
    const segments = book.relPath.split(/[\\/]/).filter(Boolean)
    const fields: Record<string, string> = {
      library: book.libraryId,
      folder: book.folderId,
      title: segments.at(-1) ?? book.title,
      author: segments.length >= 2 ? segments[0] : book.authorName,
      series: segments.length >= 3 ? segments.slice(1, -1).join('/') : ''
    }
    const srtPath = resultPaths.find((path) => extname(path).toLowerCase() === '.srt')
    if (!srtPath) throw new Error('The merged SRT result is unavailable for ABS delivery.')
    const mergedSrt = (await readFile(srtPath)).toString('utf-8')
    const formats = resultPaths
      .map((path) => extname(path).slice(1).toLowerCase())
      .filter((format): format is SubtitleFormat => ['srt', 'vtt', 'lrc'].includes(format))
    const audioFiles = [...book.audioFiles].sort((left, right) => left.index - right.index)
    const splitSrts = splitSrtByDurations(
      mergedSrt,
      audioFiles.map((audio) => audio.duration)
    )
    const uploads = audioFiles.flatMap((audio, audioIndex) => {
      const partSrt = splitSrts[audioIndex] ?? ''
      if (!partSrt.trim()) return []
      const base = basename(audio.metadata.filename, extname(audio.metadata.filename))
        .replace(/[^a-zA-Z0-9 _.-]/g, ' ')
        .trim() || `transcript-${audioIndex + 1}`
      return formats.map((format) => ({
        filename: `${base}.${format}`,
        content: Buffer.from(convertSrtToFormat(partSrt, format), 'utf-8'),
        contentType: getSubtitleMimeType(format)
      }))
    })
    if (uploads.length === 0) throw new Error('No subtitle cues were available for ABS delivery.')
    for (const [index, upload] of uploads.entries()) {
      const boundary = `----audiobookforge-${Date.now()}-${index}`
      const parts: Buffer[] = []
      for (const [name, value] of Object.entries(fields)) {
        if (!value) continue
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
      }
      const filename = upload.filename.replace(/["\r\n]/g, '_')
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="0"; filename="${filename}"\r\nContent-Type: ${upload.contentType}\r\n\r\n`),
        upload.content,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      )
      await this.postBuffer(
        session,
        `${session.baseUrl}/api/upload`,
        Buffer.concat(parts),
        `multipart/form-data; boundary=${boundary}`,
        signal
      )
    }
    await this.postBuffer(session, `${session.baseUrl}/api/items/${encodeURIComponent(book.id)}/scan`, Buffer.alloc(0), 'application/octet-stream', signal)
  }

  private async postBuffer(
    session: ServerAbsSession,
    source: string,
    body: Buffer,
    contentType: string,
    signal: AbortSignal
  ): Promise<void> {
    const url = new URL(source)
    if (url.origin !== new URL(session.baseUrl).origin) throw new Error('ABS upload origin changed.')
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const pinned = isIP(hostname)
      ? { address: hostname, family: isIP(hostname) as 4 | 6 }
      : await pinnedAddress(url)
    const lookupPinned: LookupFunction = (_hostname, _options, callback) => callback(null, pinned.address, pinned.family)
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    await new Promise<void>((resolvePost, reject) => {
      const request = transport(url, {
        method: 'POST',
        lookup: lookupPinned,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': contentType,
          'Content-Length': body.length
        },
        timeout: 30_000
      }, (response) => {
        response.resume()
        response.on('end', () => {
          const status = response.statusCode ?? 500
          if (status >= 300 && status < 400) reject(new Error('ABS upload redirects are not allowed.'))
          else if (status < 200 || status >= 300) reject(new Error(`ABS subtitle upload failed (${status}).`))
          else resolvePost()
        })
      })
      const abort = (): void => {
        request.destroy(new Error('Cancelled'))
      }
      signal.addEventListener('abort', abort, { once: true })
      request.on('close', () => signal.removeEventListener('abort', abort))
      request.on('timeout', () => request.destroy(new Error('ABS subtitle upload timed out.')))
      request.on('error', reject)
      request.end(body)
    })
  }

  private async downloadFile(
    session: ServerAbsSession,
    source: string,
    target: string,
    maxBytes: number,
    signal: AbortSignal
  ): Promise<void> {
    const url = new URL(source)
    if (url.origin !== new URL(session.baseUrl).origin) {
      throw new Error('ABS media downloads must stay on the authenticated server origin.')
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const pinned = isIP(hostname)
      ? { address: hostname, family: isIP(hostname) as 4 | 6 }
      : await pinnedAddress(url)
    const lookupPinned: LookupFunction = (_hostname, _options, callback) =>
      callback(null, pinned.address, pinned.family)
    const partial = `${target}.partial`
    rmSync(partial, { force: true })
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    await new Promise<void>((resolveDownload, reject) => {
      let settled = false
      let output: ReturnType<typeof createWriteStream> | null = null
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        if (error) {
          output?.destroy()
          reject(error)
        }
        else resolveDownload()
      }
      const request = transport(
        url,
        {
          method: 'GET',
          lookup: lookupPinned,
          headers: { Authorization: `Bearer ${session.accessToken}` },
          timeout: 30_000
        },
        (response) => {
          const status = response.statusCode ?? 500
          if (status >= 300 && status < 400) {
            response.resume()
            finish(new Error('ABS media redirects are not allowed.'))
            return
          }
          if (status < 200 || status >= 300) {
            response.resume()
            finish(new Error(`ABS media download failed (${status}).`))
            return
          }
          const declared = Number(response.headers['content-length'] ?? 0)
          if (Number.isFinite(declared) && declared > maxBytes) {
            response.destroy()
            finish(new Error('ABS media exceeds the configured download limit.'))
            return
          }
          if (
            availableBytes(dirname(target)) - Math.max(0, declared) <
            DEFAULT_STORAGE_RESERVE_BYTES
          ) {
            response.destroy()
            finish(new Error('Not enough free space to download ABS media safely.'))
            return
          }
          output = createWriteStream(partial, { flags: 'wx' })
          let received = 0
          let nextSpaceCheck = 256 * 1024 * 1024
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (received > maxBytes) request.destroy(new Error('ABS media exceeded the download limit.'))
            if (received >= nextSpaceCheck) {
              nextSpaceCheck += 256 * 1024 * 1024
              if (availableBytes(dirname(target)) < DEFAULT_STORAGE_RESERVE_BYTES) {
                request.destroy(new Error('Not enough free space to continue the ABS media download.'))
              }
            }
          })
          output.on('error', (error) => request.destroy(error))
          output.on('finish', () => finish())
          response.on('error', (error) => request.destroy(error))
          response.pipe(output)
        }
      )
      const abort = (): void => {
        request.destroy(new Error('Cancelled'))
      }
      signal.addEventListener('abort', abort, { once: true })
      request.on('timeout', () => request.destroy(new Error('ABS media download timed out.')))
      request.on('error', (error) => finish(error))
      request.end()
    }).catch((error) => {
      rmSync(partial, { force: true })
      throw error
    })
    renameSync(partial, target)
  }
}
