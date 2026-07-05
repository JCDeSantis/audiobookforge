import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { createReadStream, existsSync, statSync } from 'fs'
import { basename, extname, join, normalize, relative, resolve } from 'path'
import type { RuntimeCapabilities } from '../shared/types'
import type { ComputePreference, ManagedStorageSummary, WhisperModel } from '../shared/types'
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
import { ServerQueue, type ServerQueueInput } from './queue/serverQueue'
import { ServerQueueWorker } from './queue/serverQueueWorker'
import { ServerModelStore } from './transcription/modelStore'
import { ServerTranscriber } from './transcription/serverTranscriber'
import { isSupportedWhisperModel } from '../shared/whisperModels'
import { WHISPER_MODELS } from '../shared/whisperModels'
import { AppSettingsStore } from '../core/settings/appSettingsStore'
import { ServerAbsClient } from './abs/absClient'
import { ServerAbsSessionStore } from './abs/sessionStore'

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

function releaseJobArtifacts(
  job: ReturnType<ServerQueue['get']>,
  artifacts: ArtifactStore,
  uploads: UploadStore
): void {
  for (const artifactId of job.resultArtifactIds ?? []) {
    if (artifacts.get(artifactId)) artifacts.removeReference(artifactId, `job:${job.id}`)
  }
  if (job.uploadSessionId) uploads.releaseFromJob(job.uploadSessionId, job.id)
}

function summarizeStorage(artifacts: ArtifactStore): ManagedStorageSummary {
  const byCategory: ManagedStorageSummary['byCategory'] = {}
  let totalBytes = 0
  const active = artifacts.list().filter((artifact) => artifact.state === 'active')
  for (const artifact of active) {
    totalBytes += artifact.sizeBytes
    const category = byCategory[artifact.category] ?? { bytes: 0, count: 0 }
    category.bytes += artifact.sizeBytes
    category.count += 1
    byCategory[artifact.category] = category
  }
  return { totalBytes, artifactCount: active.length, byCategory }
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
  const settings = new AppSettingsStore(config.dataPaths.settingsFile)
  const absClient = new ServerAbsClient()
  const absSessions = new ServerAbsSessionStore(config.dataPaths)
  const queue = new ServerQueue(config.dataPaths, Date.now, (jobs) =>
    events.publish('queue.updated', jobs)
  )
  queue.load()
  const models = new ServerModelStore(config.dataPaths, artifacts)
  const transcriber = new ServerTranscriber(
    config.dataPaths,
    artifacts,
    models,
    config,
    () => settings.load().computePreference ?? 'automatic'
  )
  const worker = new ServerQueueWorker(queue, uploads, transcriber)
  worker.start()

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

      if (method === 'GET' && pathname === '/api/v1/settings') {
        sendJson(response, 200, settings.load())
        return
      }
      if (method === 'PUT' && pathname === '/api/v1/settings/abs-url') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = await readJson(request)
        if (typeof body.url !== 'string') throw new Error('ABS URL must be a string.')
        sendJson(response, 200, settings.setUrl(body.url))
        return
      }
      if (method === 'PUT' && pathname === '/api/v1/settings/default-model') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = await readJson(request)
        if (!isSupportedWhisperModel(body.model)) throw new Error('Unsupported Whisper model.')
        sendJson(response, 200, settings.setDefaultModel(body.model))
        return
      }
      if (method === 'PUT' && pathname === '/api/v1/settings/compute-preference') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = await readJson(request)
        if (body.preference !== 'automatic' && body.preference !== 'cpu') {
          throw new Error('Unsupported compute preference.')
        }
        sendJson(
          response,
          200,
          settings.setComputePreference(body.preference as ComputePreference)
        )
        return
      }

      if (method === 'POST' && pathname === '/api/v1/abs/login') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = await readJson(request)
        if (
          typeof body.url !== 'string' ||
          typeof body.username !== 'string' ||
          typeof body.password !== 'string'
        ) {
          throw new Error('Enter a valid ABS URL, username, and password.')
        }
        const login = await absClient.login(body.url, body.username, body.password)
        absSessions.save(login.session)
        settings.update({ absUrl: login.session.baseUrl, absUsername: login.result.username })
        sendJson(response, 200, login.result)
        return
      }
      if (method === 'POST' && pathname === '/api/v1/abs/logout') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        absSessions.clear()
        settings.update({ absUsername: '' })
        response.statusCode = 204
        response.end()
        return
      }
      if (method === 'GET' && pathname === '/api/v1/abs/libraries') {
        const session = absSessions.load()
        if (!session) throw new Error('Sign in to Audiobookshelf first.')
        sendJson(response, 200, await absClient.libraries(session))
        return
      }
      const absBooksMatch = pathname.match(/^\/api\/v1\/abs\/libraries\/([^/]+)\/books$/)
      if (method === 'GET' && absBooksMatch) {
        const session = absSessions.load()
        if (!session) throw new Error('Sign in to Audiobookshelf first.')
        sendJson(
          response,
          200,
          await absClient.books(session, decodeURIComponent(absBooksMatch[1]))
        )
        return
      }
      const absBookMatch = pathname.match(/^\/api\/v1\/abs\/books\/([^/]+)$/)
      if (method === 'GET' && absBookMatch) {
        const session = absSessions.load()
        if (!session) throw new Error('Sign in to Audiobookshelf first.')
        sendJson(response, 200, await absClient.book(session, decodeURIComponent(absBookMatch[1])))
        return
      }

      if (method === 'GET' && pathname === '/api/v1/storage') {
        sendJson(response, 200, summarizeStorage(artifacts))
        return
      }
      if (method === 'POST' && pathname === '/api/v1/storage/cleanup-preview') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const preview = artifacts.previewCleanup({
          categories: ['upload-source', 'result', 'checkpoint', 'temporary', 'log']
        })
        sendJson(response, 200, {
          token: preview.token,
          revision: preview.revision,
          artifactCount: preview.artifactCount,
          sizeBytes: preview.sizeBytes
        })
        return
      }
      if (method === 'POST' && pathname === '/api/v1/storage/cleanup') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = await readJson(request)
        if (typeof body.token !== 'string' || body.token.length < 10) {
          throw new Error('A valid cleanup preview token is required.')
        }
        sendJson(response, 200, artifacts.executeCleanup(body.token))
        return
      }

      if (method === 'GET' && pathname === '/api/v1/whisper/storage') {
        const gpuDetected =
          existsSync('/proc/driver/nvidia/version') ||
          (!!process.env.NVIDIA_VISIBLE_DEVICES && process.env.NVIDIA_VISIBLE_DEVICES !== 'void')
        sendJson(response, 200, {
          binaryReady: existsSync(config.whisperCpuPath),
          binaryVersion: 'docker-bundled',
          gpuEnabled: existsSync(config.whisperCudaPath),
          gpuDetected,
          modelDir: config.dataPaths.modelsDir,
          binaryDir: config.dataPaths.binariesDir,
          models: WHISPER_MODELS.map((model) => {
            const path = models.modelPath(model.id)
            const downloaded = models.isReady(model.id)
            const stats = downloaded ? statSync(path) : null
            return {
              ...model,
              diskBytes: stats?.size ?? 0,
              downloaded,
              lastModified: stats?.mtimeMs ?? null
            }
          })
        })
        return
      }
      if (method === 'DELETE' && pathname === '/api/v1/whisper/models') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const result = models.clear()
        if (result.inUse.length > 0) throw new Error('One or more Whisper models are in use.')
        sendJson(response, 200, result)
        return
      }
      const modelDeleteMatch = pathname.match(/^\/api\/v1\/whisper\/models\/([^/]+)$/)
      if (method === 'DELETE' && modelDeleteMatch) {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const model = decodeURIComponent(modelDeleteMatch[1])
        if (!isSupportedWhisperModel(model)) throw new Error('Unsupported Whisper model.')
        if (!models.delete(model as WhisperModel)) throw new Error('Whisper model is in use.')
        response.statusCode = 204
        response.end()
        return
      }

      if (method === 'GET' && pathname === '/api/v1/diagnostics') {
        const body = JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            platform: process.platform,
            architecture: process.arch,
            node: process.version,
            computePreference: settings.load().computePreference ?? 'automatic',
            cpuBinaryReady: existsSync(config.whisperCpuPath),
            cudaBinaryReady: existsSync(config.whisperCudaPath),
            storage: summarizeStorage(artifacts),
            jobs: queue.list().map((job) => ({
              id: job.id,
              status: job.status,
              source: job.source,
              model: job.model,
              computeBackend: job.computeBackend ?? 'unknown',
              computeFallbackReason: job.computeFallbackReason ?? null,
              error: job.error
            }))
          },
          null,
          2
        )
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Content-Disposition', 'attachment; filename="audiobookforge-diagnostics.json"')
        response.setHeader('Content-Length', Buffer.byteLength(body))
        response.end(body)
        return
      }

      if (method === 'GET' && pathname === '/api/v1/jobs') {
        sendJson(response, 200, queue.list())
        return
      }
      if (method === 'POST' && pathname === '/api/v1/jobs') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = (await readJson(request)) as unknown as ServerQueueInput
        if (body.source === 'upload') {
          if (!body.uploadSessionId) throw new Error('Uploaded jobs require an upload session.')
          const upload = uploads.get(body.uploadSessionId)
          if (upload.state !== 'finalized') throw new Error('Upload session is not finalized.')
          body.audioFiles = upload.files
            .filter((file) => file.kind === 'audio')
            .map((file) => file.name)
        }
        const job = queue.add(body)
        if (job.source === 'upload' && job.uploadSessionId) {
          uploads.attachToJob(job.uploadSessionId, job.id)
        }
        sendJson(response, 201, job)
        worker.kick()
        return
      }
      if (method === 'PUT' && pathname === '/api/v1/jobs/order') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const body = await readJson(request)
        if (!Array.isArray(body.orderedIds)) throw new Error('orderedIds must be an array.')
        queue.reorder(body.orderedIds.filter((id): id is string => typeof id === 'string'))
        response.statusCode = 204
        response.end()
        return
      }
      if (method === 'DELETE' && pathname === '/api/v1/jobs/finished') {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        for (const job of queue.clearFinished()) releaseJobArtifacts(job, artifacts, uploads)
        response.statusCode = 204
        response.end()
        return
      }

      const jobActionMatch = pathname.match(
        /^\/api\/v1\/jobs\/([a-f0-9-]+)\/(cancel|pause|resume|retry)$/i
      )
      if (method === 'POST' && jobActionMatch) {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        const [, jobId, action] = jobActionMatch
        if (action === 'cancel') {
          queue.cancel(jobId)
          worker.interrupt(jobId)
          releaseJobArtifacts(queue.get(jobId), artifacts, uploads)
        }
        if (action === 'pause') {
          queue.pause(jobId)
          worker.interrupt(jobId)
        }
        if (action === 'resume') {
          queue.resume(jobId)
          worker.kick()
        }
        if (action === 'retry') {
          const body = await readJson(request)
          const model = body.model === undefined ? undefined : body.model
          if (model !== undefined && !isSupportedWhisperModel(model)) {
            throw new Error('Unsupported Whisper model.')
          }
          const retry = queue.retry(jobId, model)
          if (retry.uploadSessionId) uploads.attachToJob(retry.uploadSessionId, retry.id)
          sendJson(response, 201, retry)
          worker.kick()
          return
        }
        response.statusCode = 204
        response.end()
        return
      }

      const jobMatch = pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)$/i)
      if (method === 'DELETE' && jobMatch) {
        requireSameOrigin(request, config)
        requireCsrf(request, context!.session)
        releaseJobArtifacts(queue.remove(jobMatch[1]), artifacts, uploads)
        response.statusCode = 204
        response.end()
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

      const resultDownloadMatch = pathname.match(
        /^\/api\/v1\/artifacts\/([a-f0-9-]+)\/download$/i
      )
      if ((method === 'GET' || method === 'HEAD') && resultDownloadMatch) {
        const artifact = artifacts.get(resultDownloadMatch[1])
        if (
          !artifact ||
          artifact.category !== 'result' ||
          artifact.state !== 'active' ||
          !existsSync(artifact.path)
        ) {
          sendJson(response, 404, { error: 'Result artifact was not found.' })
          return
        }
        const size = statSync(artifact.path).size
        let start = 0
        let end = Math.max(0, size - 1)
        const range = request.headers.range
        if (range) {
          const match = range.match(/^bytes=(\d*)-(\d*)$/)
          if (!match || (!match[1] && !match[2]) || size === 0) {
            response.statusCode = 416
            response.setHeader('Content-Range', `bytes */${size}`)
            response.end()
            return
          }
          if (!match[1]) {
            const suffixLength = Number(match[2])
            start = Math.max(0, size - suffixLength)
            end = size - 1
          } else {
            start = Number(match[1])
            end = match[2] ? Number(match[2]) : size - 1
          }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) {
            response.statusCode = 416
            response.setHeader('Content-Range', `bytes */${size}`)
            response.end()
            return
          }
          response.statusCode = 206
          response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
        } else {
          response.statusCode = 200
        }
        response.setHeader('Accept-Ranges', 'bytes')
        response.setHeader('Content-Type', contentType(artifact.path))
        response.setHeader('Content-Length', end - start + 1)
        response.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(basename(artifact.path))}`
        )
        if (method === 'HEAD' || size === 0) {
          response.end()
          return
        }
        const leaseId = `download:${randomUUID()}`
        artifacts.acquireLease(artifact.id, leaseId)
        let released = false
        const release = (): void => {
          if (released) return
          released = true
          artifacts.releaseLease(artifact.id, leaseId)
        }
        response.once('close', release)
        response.once('finish', release)
        createReadStream(artifact.path, { start, end }).once('error', release).pipe(response)
        return
      }

      if (method === 'GET' && pathname === '/api/v1/events') {
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/event-stream')
        response.setHeader('Cache-Control', 'no-cache, no-transform')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders()
        const lastEventId = Number(request.headers['last-event-id'] ?? 0)
        const unsubscribe = events.subscribe(
          response,
          Number.isFinite(lastEventId) ? lastEventId : 0,
          { queue: queue.list() }
        )
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
      worker.stop()
      retention.stop()
      return new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()))
      })
    }
  }
}
