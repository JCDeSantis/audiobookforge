import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { clearAbsSession, loadAbsSession, saveAbsLoginProfile, saveAbsSession } from '../settings.ipc'
import { fetchAbsBook, loginToAbs, logoutFromAbs, resolveAbsAccessToken } from '../abs.ipc'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: (error: unknown) =>
      typeof error === 'object' && error !== null && 'isAxiosError' in error
  }
}))

vi.mock('../settings.ipc', () => ({
  clearAbsSession: vi.fn(),
  loadAbsSession: vi.fn(),
  loadSettings: vi.fn(),
  saveAbsLoginProfile: vi.fn(),
  saveAbsSession: vi.fn()
}))

describe('Audiobookshelf user authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exchanges credentials for tokens without persisting the password', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        user: {
          username: 'jacob',
          type: 'admin',
          accessToken: 'access-token',
          refreshToken: 'refresh-token'
        },
        serverSettings: { version: '2.29.0' }
      }
    })

    await expect(
      loginToAbs('https://abs.example.com/', ' jacob ', 'secret-password')
    ).resolves.toEqual({
      username: 'jacob',
      userType: 'admin',
      serverVersion: '2.29.0'
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://abs.example.com/login',
      { username: 'jacob', password: 'secret-password' },
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-return-tokens': 'true' }),
        maxRedirects: 0
      })
    )
    expect(saveAbsSession).toHaveBeenCalledWith({
      baseUrl: 'https://abs.example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token'
    })
    expect(saveAbsLoginProfile).toHaveBeenCalledWith('https://abs.example.com', 'jacob')
    expect(JSON.stringify(vi.mocked(saveAbsSession).mock.calls)).not.toContain('secret-password')
  })

  it('allows private-network HTTP with an explicit connection warning', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        user: { username: 'jacob', type: 'user', accessToken: 'token' },
        serverSettings: { version: '2.29.0' }
      }
    })

    await expect(loginToAbs('http://abs.local', 'jacob', 'secret-password')).resolves.toMatchObject({
      connectionWarning: expect.stringContaining('not encrypted')
    })
  })

  it('refreshes an expired access token and stores the rotated session', async () => {
    vi.mocked(loadAbsSession).mockResolvedValue({
      baseUrl: 'https://abs.example.com',
      accessToken: 'expired-token',
      refreshToken: 'refresh-token'
    })
    vi.mocked(axios.post)
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } })
      .mockResolvedValueOnce({
        data: { user: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' } }
      })

    await expect(resolveAbsAccessToken('https://abs.example.com')).resolves.toBe(
      'new-access-token'
    )
    expect(saveAbsSession).toHaveBeenCalledWith({
      baseUrl: 'https://abs.example.com',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token'
    })
    expect(axios.post).toHaveBeenLastCalledWith(
      'https://abs.example.com/auth/refresh',
      null,
      expect.objectContaining({ maxRedirects: 0 })
    )
  })

  it('notifies the server on logout and always clears the local session', async () => {
    vi.mocked(loadAbsSession).mockResolvedValue({
      baseUrl: 'https://abs.example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token'
    })
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('server offline'))

    await expect(logoutFromAbs()).resolves.toBeUndefined()
    expect(axios.post).toHaveBeenCalledWith(
      'https://abs.example.com/logout',
      null,
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer access-token',
          'x-refresh-token': 'refresh-token'
        },
        maxRedirects: 0
      })
    )
    expect(clearAbsSession).toHaveBeenCalledOnce()
  })

  it('does not follow redirects on bearer-authenticated API requests', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: 'book-1' } })

    await fetchAbsBook('https://abs.example.com', 'access-token', 'book-1')

    expect(axios.get).toHaveBeenCalledWith(
      'https://abs.example.com/api/items/book-1?expanded=1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token' },
        maxRedirects: 0
      })
    )
  })

  it('maps an ABS ebook file id to a portable authenticated download URL', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        id: 'book-1',
        media: {
          ebookFile: {
            ino: 'ebook-file-9',
            metadata: { path: '/audiobooks/Author/Book/Book.epub' }
          }
        }
      }
    })

    await expect(
      fetchAbsBook('https://abs.example.com', 'access-token', 'book-1')
    ).resolves.toMatchObject({
      ebookPath: '/audiobooks/Author/Book/Book.epub',
      ebookDownloadUrl:
        'https://abs.example.com/api/items/book-1/file/ebook-file-9/download'
    })
  })
})
