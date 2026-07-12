import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebAppClient } from '../webAppClient'

describe('WebAppClient resumable uploads', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('requires matching file identity and resumes from the acknowledged server offset', async () => {
    const file = new File(['abcdef'], 'book.mp3', { lastModified: 123, type: 'audio/mpeg' })
    localStorage.setItem(
      'audiobookforge.pending-upload.v1',
      JSON.stringify({
        sessionId: '11111111-1111-1111-1111-111111111111',
        files: [{ name: 'book.mp3', sizeBytes: 6, lastModified: 123 }]
      })
    )
    const calls: Array<{ url: string; method: string }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const method = init.method ?? 'GET'
      calls.push({ url, method })
      if (url === '/api/v1/auth/login') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (method === 'GET' && url.endsWith('/api/v1/uploads/11111111-1111-1111-1111-111111111111')) {
        return new Response(
          JSON.stringify({
            id: '11111111-1111-1111-1111-111111111111',
            state: 'open',
            files: [
              {
                id: '22222222-2222-2222-2222-222222222222',
                name: 'book.mp3',
                sizeBytes: 6,
                offset: 3,
                kind: 'audio',
                state: 'uploading'
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (method === 'HEAD') {
        return new Response(null, { status: 204, headers: { 'Upload-Offset': '3' } })
      }
      if (method === 'PUT') {
        return new Response(null, { status: 204, headers: { 'Upload-Offset': '6' } })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new WebAppClient()
    await client.login('password')

    const result = await client.uploads.uploadFiles([file], () => undefined)

    expect(result.sessionId).toBe('11111111-1111-1111-1111-111111111111')
    expect(calls).not.toContainEqual({ url: '/api/v1/uploads', method: 'POST' })
    expect(calls.some((call) => call.method === 'HEAD')).toBe(true)
    expect(calls.some((call) => call.method === 'PUT')).toBe(true)
    expect(localStorage.getItem('audiobookforge.pending-upload.v1')).toBeNull()
  })
})
