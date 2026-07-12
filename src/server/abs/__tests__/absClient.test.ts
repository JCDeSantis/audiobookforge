import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { ServerAbsClient } from '../absClient'
import { join } from 'path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

let server: Server | null = null
let baseUrl = ''
let root = ''
let subtitleUploads = 0

describe('server ABS client', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'abf-abs-download-'))
    subtitleUploads = 0
    server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/abs/login') {
        if (request.headers['x-return-tokens'] !== 'true') {
          response.statusCode = 400
          response.end('{}')
          return
        }
        response.end(
          JSON.stringify({
            user: { username: 'jacob', type: 'user', accessToken: 'abs-token' },
            serverSettings: { version: '2.29.0' }
          })
        )
        return
      }
      if (request.url === '/abs/api/libraries') {
        response.end(JSON.stringify({ libraries: [{ id: 'lib-1', name: 'Books', mediaType: 'book' }] }))
        return
      }
      if (request.url === '/abs/api/libraries/lib-1/items?limit=500&page=0') {
        response.end(
          JSON.stringify({
            results: [
              {
                id: 'book-1',
                libraryId: 'lib-1',
                media: { metadata: { title: 'The Book', authorName: 'The Author' } }
              }
            ]
          })
        )
        return
      }
      if (request.url === '/abs/api/items/book-1?expanded=1') {
        response.end(
          JSON.stringify({
            id: 'book-1',
            libraryId: 'lib-1',
            folderId: 'folder-1',
            relPath: 'The Author/The Book',
            media: {
              metadata: { title: 'The Book', authorName: 'The Author' },
              audioFiles: [
                {
                  index: 0,
                  ino: 'audio-ino',
                  metadata: { filename: 'book.m4b', ext: '.m4b', path: 'book.m4b', relPath: 'book.m4b' },
                  duration: 10,
                  mimeType: 'audio/mp4',
                  addedAt: 1,
                  updatedAt: 1
                }
              ],
              ebookFile: { ino: 'epub-ino', metadata: { path: '/host/book.epub' } }
            }
          })
        )
        return
      }
      if (request.url?.endsWith('/file/audio-ino/download')) {
        response.end('audio-bytes')
        return
      }
      if (request.url?.endsWith('/file/epub-ino/download')) {
        response.end('epub-bytes')
        return
      }
      if (request.url === '/abs/api/upload' && request.method === 'POST') {
        subtitleUploads += 1
        request.resume()
        response.end('{}')
        return
      }
      if (request.url === '/abs/api/items/book-1/scan' && request.method === 'POST') {
        request.resume()
        response.end('{}')
        return
      }
      if (request.url === '/abs/redirect') {
        response.statusCode = 302
        response.setHeader('Location', 'http://169.254.169.254/latest/meta-data')
        response.end('{}')
        return
      }
      response.statusCode = 404
      response.end('{}')
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/abs`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve()))
    )
    server = null
    rmSync(root, { recursive: true, force: true })
  })

  it('preserves configured base paths and maps libraries and books', async () => {
    const client = new ServerAbsClient()
    const login = await client.login(baseUrl, ' jacob ', 'secret')
    expect(login.result).toMatchObject({ username: 'jacob', serverVersion: '2.29.0' })
    expect(login.result.connectionWarning).toContain('unencrypted HTTP')
    await expect(client.libraries(login.session)).resolves.toEqual([
      { id: 'lib-1', name: 'Books', mediaType: 'book' }
    ])
    await expect(client.books(login.session, 'lib-1')).resolves.toMatchObject([
      { id: 'book-1', title: 'The Book', authorName: 'The Author' }
    ])
  })

  it('downloads authenticated audio and EPUB inputs into opaque job storage', async () => {
    const client = new ServerAbsClient()
    const { session } = await client.login(baseUrl, 'jacob', 'secret')
    const result = await client.downloadBookInputs(
      session,
      'book-1',
      join(root, 'job-inputs'),
      () => undefined,
      new AbortController().signal
    )

    expect(result.audioPaths).toHaveLength(1)
    expect(readFileSync(result.audioPaths[0], 'utf-8')).toBe('audio-bytes')
    expect(readFileSync(result.epubPath!, 'utf-8')).toBe('epub-bytes')
    expect(result.epubPath).not.toContain('/host/book.epub')
  })

  it('uploads each generated subtitle and requests an ABS rescan', async () => {
    const client = new ServerAbsClient()
    const { session } = await client.login(baseUrl, 'jacob', 'secret')
    const book = await client.book(session, 'book-1')
    const srt = join(root, 'The Book.srt')
    const vtt = join(root, 'The Book.vtt')
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nHello\n')
    writeFileSync(vtt, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n')

    await client.uploadSubtitleResults(
      session,
      book,
      [srt, vtt],
      new AbortController().signal
    )

    expect(subtitleUploads).toBe(2)
  })
})
