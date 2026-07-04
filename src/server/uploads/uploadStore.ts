import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  statfsSync,
  writeFileSync,
  writeSync
} from 'fs'
import { basename, extname, join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { ArtifactStore } from '../../core/artifacts/artifactStore'
import type { DataPaths } from '../../core/platform/dataPaths'
import { readVersionedJson, writeVersionedJson } from '../../core/persistence/atomicJsonStore'
import type {
  CreateUploadFile,
  UploadFileAsset,
  UploadFileKind,
  UploadRegistryData,
  UploadSession
} from './types'

const UPLOAD_SCHEMA_VERSION = 1
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024 * 1024
export const DEFAULT_FREE_SPACE_RESERVE_BYTES = 5 * 1024 * 1024 * 1024
const ABANDONED_UPLOAD_MS = 24 * 60 * 60 * 1000
const FINALIZED_SOURCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

function classifyUpload(name: string): UploadFileKind {
  const extension = extname(name).toLowerCase()
  if (extension === '.m4b' || extension === '.mp3') return 'audio'
  if (extension === '.epub') return 'epub'
  throw new Error('Uploads support .m4b, .mp3, and optional .epub files only.')
}

function isUploadRegistryData(value: unknown): value is UploadRegistryData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessions' in value &&
    Array.isArray(value.sessions)
  )
}

function copySession(session: UploadSession): UploadSession {
  return { ...session, files: session.files.map((file) => ({ ...file })) }
}

export class UploadStore {
  private data: UploadRegistryData = { sessions: [] }

  constructor(
    private readonly paths: DataPaths,
    private readonly artifacts: ArtifactStore,
    private readonly now: () => number = Date.now,
    private readonly maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
    private readonly freeSpaceReserveBytes = DEFAULT_FREE_SPACE_RESERVE_BYTES
  ) {}

  load(): void {
    mkdirSync(this.paths.uploadsDir, { recursive: true })
    if (!existsSync(this.paths.uploadSessionsFile)) return
    this.data = readVersionedJson({
      filePath: this.paths.uploadSessionsFile,
      schemaVersion: UPLOAD_SCHEMA_VERSION,
      validate: isUploadRegistryData,
      migrateLegacy: () => {
        throw new Error('No legacy upload session format exists.')
      }
    }).data
  }

  create(files: CreateUploadFile[]): UploadSession {
    if (!Array.isArray(files) || files.length === 0) throw new Error('Select at least one file.')
    const normalized = files.map((file) => {
      if (!file || typeof file.name !== 'string' || basename(file.name) !== file.name) {
        throw new Error('Upload filenames cannot contain paths.')
      }
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) {
        throw new Error('Upload sizes must be positive safe integers.')
      }
      if (!Number.isFinite(file.lastModified) || file.lastModified < 0) {
        throw new Error('Upload modification times must be valid numbers.')
      }
      if (file.sha256 !== undefined && !isSha256(file.sha256)) {
        throw new Error('Expected file checksums must be SHA-256 hex strings.')
      }
      return { ...file, kind: classifyUpload(file.name) }
    })
    if (normalized.filter((file) => file.kind === 'epub').length > 1) {
      throw new Error('An upload session can contain only one EPUB file.')
    }
    if (!normalized.some((file) => file.kind === 'audio')) {
      throw new Error('An upload session requires at least one audiobook file.')
    }
    const totalBytes = normalized.reduce((total, file) => total + file.sizeBytes, 0)
    if (totalBytes > this.maxUploadBytes) throw new Error('Upload session exceeds the size limit.')

    const timestamp = this.now()
    const sessionId = randomUUID()
    const sessionDir = join(this.paths.uploadsDir, sessionId)
    mkdirSync(sessionDir, { recursive: true })
    const assets: UploadFileAsset[] = normalized.map((file) => {
      const id = randomUUID()
      const path = join(sessionDir, `${id}.part`)
      writeFileSync(path, Buffer.alloc(0), { flag: 'wx' })
      return {
        id,
        name: file.name,
        kind: file.kind,
        sizeBytes: file.sizeBytes,
        lastModified: file.lastModified,
        offset: 0,
        state: 'uploading',
        path,
        expectedSha256: file.sha256?.toLowerCase() ?? null,
        sha256: null,
        artifactId: null
      }
    })
    const session: UploadSession = {
      id: sessionId,
      state: 'open',
      files: assets,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + ABANDONED_UPLOAD_MS
    }
    this.data.sessions.push(session)
    this.persist()
    return copySession(session)
  }

  get(sessionId: string): UploadSession {
    return copySession(this.requireSession(sessionId))
  }

  appendChunk(
    sessionId: string,
    fileId: string,
    offset: number,
    chunk: Buffer,
    chunkSha256: string
  ): UploadFileAsset {
    const session = this.requireSession(sessionId)
    const file = this.requireFile(session, fileId)
    if (session.state !== 'open' || file.state !== 'uploading') {
      throw new Error('This upload file is not accepting chunks.')
    }
    if (offset !== file.offset) throw new Error(`Upload offset mismatch; expected ${file.offset}.`)
    if (chunk.length === 0 || chunk.length > UPLOAD_CHUNK_BYTES) {
      throw new Error(`Upload chunks must be between 1 and ${UPLOAD_CHUNK_BYTES} bytes.`)
    }
    if (file.offset + chunk.length > file.sizeBytes) throw new Error('Chunk exceeds declared size.')
    if (!isSha256(chunkSha256)) throw new Error('A valid chunk SHA-256 checksum is required.')
    const actualChunkSha256 = createHash('sha256').update(chunk).digest('hex')
    if (actualChunkSha256 !== chunkSha256.toLowerCase()) throw new Error('Chunk checksum mismatch.')
    this.assertFreeSpace(chunk.length)

    const descriptor = openSync(file.path, 'r+')
    try {
      writeSync(descriptor, chunk, 0, chunk.length, file.offset)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    file.offset += chunk.length
    session.updatedAt = this.now()
    session.expiresAt = session.updatedAt + ABANDONED_UPLOAD_MS
    this.persist()
    return { ...file }
  }

  async finalizeFile(sessionId: string, fileId: string): Promise<UploadFileAsset> {
    const session = this.requireSession(sessionId)
    const file = this.requireFile(session, fileId)
    if (session.state !== 'open' || file.state !== 'uploading') {
      throw new Error('This upload file cannot be finalized.')
    }
    if (file.offset !== file.sizeBytes) throw new Error('Upload is incomplete.')
    const sha256 = await this.hashFile(file.path)
    if (file.expectedSha256 && file.expectedSha256 !== sha256) {
      throw new Error('Completed file checksum mismatch.')
    }
    const finalPath = join(this.paths.uploadsDir, session.id, `${file.id}.data`)
    renameSync(file.path, finalPath)
    file.path = finalPath
    file.sha256 = sha256
    file.state = 'finalized'
    const artifact = this.artifacts.register({
      category: 'upload-source',
      path: finalPath,
      sizeBytes: file.sizeBytes,
      expiresAt: this.now() + FINALIZED_SOURCE_RETENTION_MS,
      references: [`upload-session:${session.id}`]
    })
    file.artifactId = artifact.id
    session.updatedAt = this.now()
    this.persist()
    return { ...file }
  }

  finalizeSession(sessionId: string): UploadSession {
    const session = this.requireSession(sessionId)
    if (session.state !== 'open') throw new Error('Upload session is not open.')
    if (session.files.some((file) => file.state !== 'finalized')) {
      throw new Error('All upload files must be finalized first.')
    }
    session.state = 'finalized'
    session.updatedAt = this.now()
    session.expiresAt = session.updatedAt + FINALIZED_SOURCE_RETENTION_MS
    this.persist()
    return copySession(session)
  }

  private requireSession(sessionId: string): UploadSession {
    const session = this.data.sessions.find((entry) => entry.id === sessionId)
    if (!session) throw new Error('Upload session was not found.')
    return session
  }

  private requireFile(session: UploadSession, fileId: string): UploadFileAsset {
    const file = session.files.find((entry) => entry.id === fileId)
    if (!file) throw new Error('Upload file was not found.')
    return file
  }

  private persist(): void {
    writeVersionedJson(this.paths.uploadSessionsFile, UPLOAD_SCHEMA_VERSION, this.data)
  }

  private assertFreeSpace(incomingBytes: number): void {
    const stats = statfsSync(this.paths.root)
    const availableBytes = Number(stats.bavail) * Number(stats.bsize)
    if (availableBytes - incomingBytes < this.freeSpaceReserveBytes) {
      throw new Error('Not enough free space to accept this upload chunk safely.')
    }
  }

  private hashFile(path: string): Promise<string> {
    return new Promise((resolveHash, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolveHash(hash.digest('hex')))
    })
  }
}
