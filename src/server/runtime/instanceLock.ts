import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync
} from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { DataPaths } from '../../core/platform/dataPaths'

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class ServerInstanceLock {
  private readonly path: string
  private readonly token = `${process.pid}:${randomUUID()}`
  private acquired = false

  constructor(paths: DataPaths) {
    this.path = join(paths.root, 'runtime', 'server.lock')
  }

  acquire(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    if (existsSync(this.path)) {
      const existing = readFileSync(this.path, 'utf-8').trim()
      const existingPid = Number(existing.split(':')[0])
      if (processIsAlive(existingPid)) {
        throw new Error('Another Audiobook Forge server is already using this data directory.')
      }
      rmSync(this.path, { force: true })
    }
    const descriptor = openSync(this.path, 'wx', 0o600)
    try {
      writeSync(descriptor, this.token, undefined, 'utf-8')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    this.acquired = true
  }

  release(): void {
    if (!this.acquired) return
    try {
      if (readFileSync(this.path, 'utf-8').trim() === this.token) rmSync(this.path, { force: true })
    } catch {
      // The lock may already be gone after an external volume reset.
    }
    this.acquired = false
  }
}
