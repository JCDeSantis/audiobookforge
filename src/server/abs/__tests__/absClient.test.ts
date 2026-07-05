import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { ServerAbsClient } from '../absClient'

let server: Server | null = null
let baseUrl = ''

describe('server ABS client', () => {
  beforeEach(async () => {
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
})
