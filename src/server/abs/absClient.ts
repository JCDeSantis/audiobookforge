import { lookup } from 'dns/promises'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import type { LookupFunction } from 'net'
import { isIP } from 'net'
import type { AbsBook, AbsLibrary, AbsLoginResult } from '../../shared/types'
import {
  isBlockedNetworkHostname,
  isPrivateHostname,
  validateAbsUrl
} from '../../shared/urlSafety'
import { mapAbsItemToBook, type AbsApiItem, type AbsApiLibrary } from '../../core/abs/mapping'
import type { ServerAbsSession } from './sessionStore'

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
}
