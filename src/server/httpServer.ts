import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, join, normalize, relative, resolve } from 'path'
import type { RuntimeCapabilities } from '../shared/types'
import { EventBroker } from './events/eventBroker'
import { LoginRateLimiter } from './http/rateLimiter'
import { loadConfiguredPassword, verifyPassword } from './auth/passwordVerifier'
import {
  loadOrCreateSessionSecret,
  SessionManager,
  type VerifiedSession
} from './auth/sessionManager'
import type { ServerRuntimeConfig } from './runtimeConfig'
import { ArtifactStore } from '../core/artifacts/artifactStore'
import { RetentionService } from '../core/artifacts/retentionService'
import { UPLOAD_CHUNK_BYTES, UploadStore } from './uploads/uploadStore'
import type { CreateUploadFile } from './uploads/types'

const SESSION_COOKIE = 'abf_session'
const MAX_JSON_BYTES = 16 * 1024

const WEB_CAPABILITIES: RuntimeCapabilities = {
  runtime: 'docker-web',
  nativeFilePicker: false,
  browserUploads: true,
  nativeOutputFolder: false,
  resultDownloads: true,
  singleUser: true
}

interface RequestContext {
  session: VerifiedSession
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
  )
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim())
  }
  return cookies
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_JSON_BYTES) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON request body must be an object.')
  }
  return parsed as Record<string, unknown>
}

async function readBuffer(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maxBytes) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function requestIsSecure(request: IncomingMessage, config: ServerRuntimeConfig): boolean {
  if ('encrypted' in request.socket && request.socket.encrypted) return true
  return config.trustProxy && request.headers['x-forwarded-proto'] === 'https'
}

function expectedOrigin(request: IncomingMessage, config: ServerRuntimeConfig): string | null {
  const host = request.headers.host
  if (!host) return null
  return `${requestIsSecure(request, config) ? 'https' : 'http'}://${host}`
}

function requireSameOrigin(request: IncomingMessage, config: ServerRuntimeConfig): void {
  const origin = request.headers.origin
  const expected = expectedOrigin(request, config)
  if (!origin || !expected || origin !== expected) throw new Error('Request origin was rejected.')
}

function requireCsrf(request: IncomingMessage, session: VerifiedSession): void {
  if (request.headers['x-abf-csrf'] !== session.csrf) throw new Error('CSRF token was rejected.')
}

function clientKey(request: IncomingMessage, config: ServerRuntimeConfig): string {
  if (config.trustProxy) {
    const forwarded = request.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  }
  return request.socket.remoteAddress ?? 'unknown'
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function serveStatic(pathname: string, config: ServerRuntimeConfig, response: ServerResponse): void {
  const requested = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '')
  let filePath = resolve(config.webRoot, requested)
  if (relative(config.webRoot, filePath).startsWith('..')) {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(config.webRoot, 'index.html')
  }
  if (!existsSync(filePath)) {
    sendJson(response, 503, { error: 'Web application assets are not built.' })
    return
  }
  response.statusCode = 200
  response.setHeader('Content-Type', contentType(filePath))
  createReadStream(filePath).pipe(response)
}

export interface WebServerRuntime {
  server: Server
  events: EventBroker
  close: () => Promise<void>
}

export function createWebServer(config: ServerRuntimeConfig): WebServerRuntime {
  const configuredPassword = loadConfiguredPassword(config)
  const sessions = new SessionManager(loadOrCreateSessionSecret(config.sessionSecretFile))
  const limiter = new LoginRateLimiter()
  const events = new EventBroker()
  const artifacts = new ArtifactStore(config.dataPaths)
  artifacts.load()
  const retention = new RetentionService(artifacts)
  retention.start()
  const uploads = new UploadStore(config.dataPaths, artifacts)
  uploads.load()

  const authenticate = (request: IncomingMessage): RequestContext | null => {
    const session = sessions.verify(parseCookies(request)[SESSION_COOKIE])
    return session ? { session } : null
  }

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response)
    const method = request.method ?? 'GET'
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname

    try {
      if (method === 'GET' && pathname === '/healthz') {
        sendJson(response, 200, { status: 'ok' })
        return
      }

      if (method === 'POST' && pathname === '/api/v1/auth/login') {
        requireSameOrigin(request, config)
        const key = clientKey(request, config)
        if (!limiter.allow(key)) {
          sendJson(response, 429, { error: 'Too many login attempts. Try again later.' })
          return
        }
        const body = await readJson(request)
        const candidate = typeof body.password === 'string' ? body.password : ''
        if (!verifyPassword(candidate, configuredPassword)) {
          limiter.recordFailure(key)
          sendJson(response, 401, { error: 'Incorrect password.' })
          return
        }
        limiter.clear(key)
        const issued = sessions.issue()
        const secure = requestIsSecure(request, config) ? '; Secure' : ''
        response.setHeader(
          'Set-Cookie',
          `${SESSION_COOKIE}=${encodeURIComponent(issued.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`
        )
        sendJson(response, 200, { authenticated: true, csrfToken: issued.session.csrf })
        return
      }

      const context = pathname.startsWith('/api/') ? authenticate(request) : null
      if (pathname.startsWith('/api/') && !context) {
        sendJson(response, 401, { error: 'Authentication required.' })
        return
      }

      if (method === 'GET' && pathname === '/api/v1/auth/session') {
        sendJson(response, 200, { authenticated: true, csrfToken: context!.session.csrf })
        return
      }

      if (method === 'POST' && pathname === '/api/v1/auth/logout') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        sessions.revoke(context!.session)
        response.setHeader(
          'Set-Cookie',
          `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
        )
        sendJson(response, 200, { authenticated: false })
        return
      }

      if (method === 'GET' && pathname === '/api/v1/capabilities') {
        sendJson(response, 200, WEB_CAPABILITIES)
        return
      }

      if (method === 'POST' && pathname === '/api/v1/uploads') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = await readJson(request)
        if (!Array.isArray(body.files)) throw new Error('Upload files must be an array.')
        const session = uploads.create(body.files as CreateUploadFile[])
        events.publish('upload.updated', session)
        sendJson(response, 201, session)
        return
      }

      const uploadSessionMatch = pathname.match(/^\/api\/v1\/uploads\/([a-f0-9-]+)$/i)
      if (method === 'GET' && uploadSessionMatch) {
        sendJson(response, 200, uploads.get(uploadSessionMatch[1]))
        return
      }

      const uploadFileMatch = pathname.match(
        /^\/api\/v1\/uploads\/([a-f0-9-]+)\/files\/([a-f0-9-]+)$/i
      )
      if (method === 'HEAD' && uploadFileMatch) {
        const session = uploads.get(uploadFileMatch[1])
        const file = session.files.find((entry) => entry.id === uploadFileMatch[2])
        if (!file) throw new Error('Upload file was not found.')
        response.statusCode = 204
        response.setHeader('Upload-Offset', file.offset)
        response.setHeader('Upload-Length', file.sizeBytes)
        response.end()
        return
      }
      if (method === 'PUT' && uploadFileMatch) {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const offset = Number(request.headers['upload-offset'])
        const checksum = request.headers['x-chunk-sha256']
        if (!Number.isSafeInteger(offset) || offset < 0 || typeof checksum !== 'string') {
          throw new Error('Upload offset and chunk checksum headers are required.')
        }
        const chunk = await readBuffer(request, UPLOAD_CHUNK_BYTES)
        const file = uploads.appendChunk(
          uploadFileMatch[1],
          uploadFileMatch[2],
          offset,
          chunk,
          checksum
        )
        events.publish('upload.updated', uploads.get(uploadFileMatch[1]))
        response.statusCode = 204
        response.setHeader('Upload-Offset', file.offset)
        response.end()
        return
      }

      const finalizeFileMatch = pathname.match(
        /^\/api\/v1\/uploads\/([a-f0-9-]+)\/files\/([a-f0-9-]+)\/finalize$/i
      )
      if (method === 'POST' && finalizeFileMatch) {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const file = await uploads.finalizeFile(finalizeFileMatch[1], finalizeFileMatch[2])
        events.publish('upload.updated', uploads.get(finalizeFileMatch[1]))
        sendJson(response, 200, file)
        return
      }

      const finalizeSessionMatch = pathname.match(
        /^\/api\/v1\/uploads\/([a-f0-9-]+)\/finalize$/i
      )
      if (method === 'POST' && finalizeSessionMatch) {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const session = uploads.finalizeSession(finalizeSessionMatch[1])
        events.publish('upload.updated', session)
        sendJson(response, 200, session)
        return
      }

      if (method === 'GET' && pathname === '/api/v1/events') {
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/event-stream')
        response.setHeader('Cache-Control', 'no-cache, no-transform')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders()
        const lastEventId = Number(request.headers['last-event-id'] ?? 0)
        const unsubscribe = events.subscribe(response, Number.isFinite(lastEventId) ? lastEventId : 0, {
          queue: [],
          revision: 0
        })
        request.on('close', unsubscribe)
        return
      }

      if (pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'API endpoint not found.' })
        return
      }

      if (method === 'GET' || method === 'HEAD') {
        serveStatic(pathname, config, response)
        return
      }
      sendJson(response, 405, { error: 'Method not allowed.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      const status = /origin|CSRF/.test(message)
        ? 403
        : /not found/.test(message)
          ? 404
          : /offset mismatch/.test(message)
            ? 409
            : /too large/.test(message)
              ? 413
              : /Not enough free space/.test(message)
                ? 507
                : /Upload|upload|checksum|files|size|JSON|body/.test(message)
                  ? 400
                  : 500
      sendJson(response, status, { error: message })
    }
  })

  return {
    server,
    events,
    close: () => {
      retention.stop()
      return new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()))
      })
    }
  }
}
