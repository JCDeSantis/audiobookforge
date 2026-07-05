import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { ServerAbsSessionStore } from '../sessionStore'

let root = ''

describe('server ABS session store', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-abs-session-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('persists the token privately and removes it on logout', () => {
    const store = new ServerAbsSessionStore(createDataPaths(root))
    store.save({ baseUrl: 'https://abs.example.com', accessToken: 'token' })
    expect(store.load()).toEqual({ baseUrl: 'https://abs.example.com', accessToken: 'token' })
    const path = join(root, 'config', 'abs-session.json')
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    store.clear()
    expect(existsSync(path)).toBe(false)
    expect(store.load()).toBeNull()
  })
})
