import { chmodSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { readVersionedJson, writeVersionedJson } from '../../core/persistence/atomicJsonStore'
import type { DataPaths } from '../../core/platform/dataPaths'

export interface ServerAbsSession {
  baseUrl: string
  accessToken: string
  refreshToken?: string
}

function isSession(value: unknown): value is ServerAbsSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<ServerAbsSession>
  return (
    typeof session.baseUrl === 'string' &&
    typeof session.accessToken === 'string' &&
    (session.refreshToken === undefined || typeof session.refreshToken === 'string')
  )
}

export class ServerAbsSessionStore {
  private readonly path: string

  constructor(paths: DataPaths) {
    this.path = join(paths.root, 'config', 'abs-session.json')
  }

  load(): ServerAbsSession | null {
    if (!existsSync(this.path)) return null
    return readVersionedJson({
      filePath: this.path,
      schemaVersion: 1,
      validate: isSession,
      migrateLegacy: (value) => {
        if (!isSession(value)) throw new Error('Invalid ABS session data.')
        return value
      }
    }).data
  }

  save(session: ServerAbsSession): void {
    writeVersionedJson(this.path, 1, session)
    chmodSync(this.path, 0o600)
    if (existsSync(`${this.path}.bak`)) chmodSync(`${this.path}.bak`, 0o600)
  }

  clear(): void {
    rmSync(this.path, { force: true })
    rmSync(`${this.path}.bak`, { force: true })
  }
}
