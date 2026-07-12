import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { writeVersionedJson } from '../../../core/persistence/atomicJsonStore'
import { ServerAbsSessionStore } from '../sessionStore'

let root = ''
const secret = Buffer.alloc(48, 7)

describe('server ABS session store', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-abs-session-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('encrypts tokens at rest and removes them on logout', () => {
    const store = new ServerAbsSessionStore(createDataPaths(root), secret)
    store.save({ baseUrl: 'https://abs.example.com', accessToken: 'sensitive-token' })

    expect(store.load()).toEqual({
      baseUrl: 'https://abs.example.com',
      accessToken: 'sensitive-token'
    })
    const path = join(root, 'config', 'abs-session.enc.json')
    expect(readFileSync(path, 'utf-8')).not.toContain('sensitive-token')
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    store.clear()
    expect(existsSync(path)).toBe(false)
    expect(store.load()).toBeNull()
  })

  it('migrates and deletes a legacy plaintext session', () => {
    const legacyPath = join(root, 'config', 'abs-session.json')
    writeVersionedJson(legacyPath, 1, {
      baseUrl: 'https://abs.example.com',
      accessToken: 'legacy-token'
    })
    const store = new ServerAbsSessionStore(createDataPaths(root), secret)

    expect(store.load()?.accessToken).toBe('legacy-token')
    expect(existsSync(legacyPath)).toBe(false)
    expect(readFileSync(join(root, 'config', 'abs-session.enc.json'), 'utf-8')).not.toContain(
      'legacy-token'
    )
  })

  it('rejects a session encrypted with a different server secret', () => {
    new ServerAbsSessionStore(createDataPaths(root), secret).save({
      baseUrl: 'https://abs.example.com',
      accessToken: 'token'
    })

    expect(() =>
      new ServerAbsSessionStore(createDataPaths(root), Buffer.alloc(48, 9)).load()
    ).toThrow('could not be decrypted')
  })
})
