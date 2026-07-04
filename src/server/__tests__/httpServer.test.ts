import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AddressInfo } from 'net'
import { createHash } from 'crypto'
import { createDataPaths } from '../../core/platform/dataPaths'
import { createWebServer, type WebServerRuntime } from '../httpServer'
import type { ServerRuntimeConfig } from '../runtimeConfig'

let root = ''
let runtime: WebServerRuntime | null = null
let baseUrl = ''

describe('authenticated web runtime', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'abf-server-'))
    const webRoot = join(root, 'web')
    mkdirSync(webRoot, { recursive: true })
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Audiobook Forge</title>')
    const config: ServerRuntimeConfig = {
      host: '127.0.0.1',
      port: 0,
      dataPaths: createDataPaths(join(root, 'data')),
      passwordFile: null,
      password: 'correct-password',
      trustProxy: false,
      sessionSecretFile: join(root, 'session.key'),
      webRoot
    }
    runtime = createWebServer(config)
    await new Promise<void>((resolveListen) => runtime!.server.listen(0, '127.0.0.1', resolveListen))
    const address = runtime.server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await runtime?.close()
    runtime = null
    rmSync(root, { recursive: true, force: true })
  })

  it('serves health and web assets without exposing protected capabilities', async () => {
    const health = await fetch(`${baseUrl}/healthz`)
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toEqual({ status: 'ok' })

    const page = await fetch(baseUrl)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Audiobook Forge')

    expect((await fetch(`${baseUrl}/api/v1/capabilities`)).status).toBe(401)
  })

  it('requires the configured password and CSRF token for authenticated state changes', async () => {
    const wrong = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ password: 'wrong' })
    })
    expect(wrong.status).toBe(401)

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ password: 'correct-password' })
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    const loginBody = (await login.json()) as { csrfToken: string }
    expect(cookie).toContain('abf_session=')

    const capabilities = await fetch(`${baseUrl}/api/v1/capabilities`, {
      headers: { Cookie: cookie! }
    })
    expect(capabilities.status).toBe(200)
    await expect(capabilities.json()).resolves.toMatchObject({
      runtime: 'docker-web',
      browserUploads: true
    })

    const rejectedLogout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie!, Origin: baseUrl }
    })
    expect(rejectedLogout.status).toBe(403)

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie!,
        Origin: baseUrl,
        'X-ABF-CSRF': loginBody.csrfToken
      }
    })
    expect(logout.status).toBe(200)
    expect(
      (
        await fetch(`${baseUrl}/api/v1/auth/session`, {
          headers: { Cookie: cookie! }
        })
      ).status
    ).toBe(401)
  })

  it('accepts resumable checksummed upload chunks through authenticated endpoints', async () => {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ password: 'correct-password' })
    })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const { csrfToken } = (await login.json()) as { csrfToken: string }
    const content = Buffer.from('browser audiobook')
    const checksum = createHash('sha256').update(content).digest('hex')
    const headers = {
      Cookie: cookie,
      Origin: baseUrl,
      'X-ABF-CSRF': csrfToken
    }

    const created = await fetch(`${baseUrl}/api/v1/uploads`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            name: 'book.m4b',
            sizeBytes: content.length,
            lastModified: 123,
            sha256: checksum
          }
        ]
      })
    })
    expect(created.status).toBe(201)
    const session = (await created.json()) as { id: string; files: Array<{ id: string }> }
    const fileId = session.files[0].id

    const uploaded = await fetch(
      `${baseUrl}/api/v1/uploads/${session.id}/files/${fileId}`,
      {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'Upload-Offset': '0',
          'X-Chunk-SHA256': checksum
        },
        body: content
      }
    )
    expect(uploaded.status).toBe(204)
    expect(uploaded.headers.get('upload-offset')).toBe(String(content.length))

    expect(
      (
        await fetch(`${baseUrl}/api/v1/uploads/${session.id}/files/${fileId}/finalize`, {
          method: 'POST',
          headers
        })
      ).status
    ).toBe(200)
    expect(
      (
        await fetch(`${baseUrl}/api/v1/uploads/${session.id}/finalize`, {
          method: 'POST',
          headers
        })
      ).status
    ).toBe(200)
  })
})
