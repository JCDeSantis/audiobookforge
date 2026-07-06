import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { chmodSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { readVersionedJson, writeVersionedJson } from '../../core/persistence/atomicJsonStore'
import type { DataPaths } from '../../core/platform/dataPaths'

export interface ServerAbsSession {
  baseUrl: string
  accessToken: string
  refreshToken?: string
}

interface EncryptedAbsSession {
  algorithm: 'aes-256-gcm'
  iv: string
  ciphertext: string
  authTag: string
}

const AUTH_CONTEXT = Buffer.from('audiobookforge:abs-session:v1', 'utf-8')

function isSession(value: unknown): value is ServerAbsSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<ServerAbsSession>
  return (
    typeof session.baseUrl === 'string' &&
    typeof session.accessToken === 'string' &&
    (session.refreshToken === undefined || typeof session.refreshToken === 'string')
  )
}

function isEncryptedSession(value: unknown): value is EncryptedAbsSession {
  if (!value || typeof value !== 'object') return false
  const encrypted = value as Partial<EncryptedAbsSession>
  return (
    encrypted.algorithm === 'aes-256-gcm' &&
    typeof encrypted.iv === 'string' &&
    typeof encrypted.ciphertext === 'string' &&
    typeof encrypted.authTag === 'string'
  )
}

export class ServerAbsSessionStore {
  private readonly path: string
  private readonly legacyPath: string
  private readonly key: Buffer

  constructor(paths: DataPaths, encryptionSecret: Buffer) {
    if (encryptionSecret.length < 32) {
      throw new Error('ABS session encryption requires a secret of at least 32 bytes.')
    }
    this.path = join(paths.root, 'config', 'abs-session.enc.json')
    this.legacyPath = join(paths.root, 'config', 'abs-session.json')
    this.key = createHash('sha256').update(AUTH_CONTEXT).update(encryptionSecret).digest()
  }

  load(): ServerAbsSession | null {
    if (!existsSync(this.path)) return this.migrateLegacy()
    const encrypted = readVersionedJson({
      filePath: this.path,
      schemaVersion: 1,
      validate: isEncryptedSession,
      migrateLegacy: (value) => {
        if (!isEncryptedSession(value)) throw new Error('Invalid encrypted ABS session data.')
        return value
      }
    }).data
    return this.decrypt(encrypted)
  }

  save(session: ServerAbsSession): void {
    if (!isSession(session)) throw new Error('Invalid ABS session data.')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(AUTH_CONTEXT)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(session), 'utf-8'),
      cipher.final()
    ])
    writeVersionedJson<EncryptedAbsSession>(this.path, 1, {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    })
    this.protect(this.path)
    this.removeLegacy()
  }

  clear(): void {
    rmSync(this.path, { force: true })
    rmSync(`${this.path}.bak`, { force: true })
    this.removeLegacy()
  }

  private decrypt(encrypted: EncryptedAbsSession): ServerAbsSession {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(encrypted.iv, 'base64')
      )
      decipher.setAAD(AUTH_CONTEXT)
      decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
        decipher.final()
      ])
      const session = JSON.parse(plaintext.toString('utf-8')) as unknown
      if (!isSession(session)) throw new Error('Invalid decrypted ABS session data.')
      return session
    } catch (error) {
      throw new Error('The saved ABS session could not be decrypted.', { cause: error })
    }
  }

  private migrateLegacy(): ServerAbsSession | null {
    if (!existsSync(this.legacyPath)) return null
    const session = readVersionedJson({
      filePath: this.legacyPath,
      schemaVersion: 1,
      validate: isSession,
      migrateLegacy: (value) => {
        if (!isSession(value)) throw new Error('Invalid ABS session data.')
        return value
      }
    }).data
    this.save(session)
    return session
  }

  private protect(path: string): void {
    chmodSync(path, 0o600)
    if (existsSync(`${path}.bak`)) chmodSync(`${path}.bak`, 0o600)
  }

  private removeLegacy(): void {
    rmSync(this.legacyPath, { force: true })
    rmSync(`${this.legacyPath}.bak`, { force: true })
  }
}
