import type {
  AppSettings,
  ComputePreference,
  ManagedCleanupPreview,
  ManagedStorageSummary,
  RuntimeCapabilities,
  TranscriptionJob,
  WhisperModel,
  WhisperStorageInfo
} from '../../../shared/types'
import type { WebUploadSelection } from '../../../shared/types'
import type { AppClient } from './ipc'

const DEFAULT_SETTINGS: AppSettings = {
  absUrl: '',
  absUsername: '',
  defaultModel: 'large-v3-turbo-q5_0',
  computePreference: 'automatic'
}

export class WebAppClient implements AppClient {
  private csrfToken: string | null = null

  async restoreSession(): Promise<boolean> {
    const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin' })
    if (!response.ok) return false
    const body = (await response.json()) as { csrfToken: string }
    this.csrfToken = body.csrfToken
    return true
  }

  async login(password: string): Promise<void> {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
    const body = (await response.json()) as { csrfToken?: string; error?: string }
    if (!response.ok || !body.csrfToken) throw new Error(body.error ?? 'Login failed.')
    this.csrfToken = body.csrfToken
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
      if (!this.csrfToken) throw new Error('The web session is not initialized.')
      headers.set('X-ABF-CSRF', this.csrfToken)
    }
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Request failed (${response.status}).`)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  runtime = {
    getCapabilities: () => this.request<RuntimeCapabilities>('/api/v1/capabilities')
  }

  settings = {
    get: async (): Promise<AppSettings> =>
      this.request<AppSettings>('/api/v1/settings').catch(() => DEFAULT_SETTINGS),
    setUrl: (url: string) =>
      this.request<void>('/api/v1/settings/abs-url', {
        method: 'PUT',
        body: JSON.stringify({ url })
      }),
    setDefaultModel: (model: WhisperModel) =>
      this.request<void>('/api/v1/settings/default-model', {
        method: 'PUT',
        body: JSON.stringify({ model })
      }),
    setComputePreference: (preference: ComputePreference) =>
      this.request<void>('/api/v1/settings/compute-preference', {
        method: 'PUT',
        body: JSON.stringify({ preference })
      })
  }

  files = {
    pickAudio: async (): Promise<null> => null,
    pickEpub: async (): Promise<null> => null,
    pickOutputFolder: async (): Promise<null> => null,
    showInExplorer: async (): Promise<void> => undefined,
    downloadArtifact: async (artifactId: string): Promise<void> => {
      const link = document.createElement('a')
      link.href = `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download`
      link.click()
    }
  }

  uploads = {
    uploadFiles: async (
      files: File[],
      onProgress: (percent: number) => void
    ): Promise<WebUploadSelection> => {
      if (files.length === 0) throw new Error('Select at least one audiobook file.')
      const session = await this.request<{
        id: string
        files: Array<{ id: string; name: string; sizeBytes: number; offset: number; kind: string }>
      }>('/api/v1/uploads', {
        method: 'POST',
        body: JSON.stringify({
          files: files.map((file) => ({
            name: file.name,
            sizeBytes: file.size,
            lastModified: file.lastModified
          }))
        })
      })
      const totalBytes = files.reduce((total, file) => total + file.size, 0)
      let uploadedBytes = 0

      for (const localFile of files) {
        const remoteFile = session.files.find((entry) => entry.name === localFile.name)
        if (!remoteFile) throw new Error(`Upload session did not accept ${localFile.name}.`)
        let offset = remoteFile.offset
        while (offset < localFile.size) {
          const chunk = localFile.slice(offset, Math.min(offset + 16 * 1024 * 1024, localFile.size))
          const bytes = await chunk.arrayBuffer()
          const checksumBytes = await crypto.subtle.digest('SHA-256', bytes)
          const checksum = Array.from(new Uint8Array(checksumBytes), (byte) =>
            byte.toString(16).padStart(2, '0')
          ).join('')
          const response = await fetch(
            `/api/v1/uploads/${session.id}/files/${remoteFile.id}`,
            {
              method: 'PUT',
              credentials: 'same-origin',
              headers: {
                'Content-Type': 'application/octet-stream',
                'Upload-Offset': String(offset),
                'X-Chunk-SHA256': checksum,
                'X-ABF-CSRF': this.csrfToken ?? ''
              },
              body: bytes
            }
          )
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error ?? `Upload failed (${response.status}).`)
          }
          const nextOffset = Number(response.headers.get('Upload-Offset'))
          if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
            throw new Error('The server returned an invalid upload offset.')
          }
          uploadedBytes += nextOffset - offset
          offset = nextOffset
          onProgress(Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)))
        }
        await this.request(`/api/v1/uploads/${session.id}/files/${remoteFile.id}/finalize`, {
          method: 'POST'
        })
      }

      await this.request(`/api/v1/uploads/${session.id}/finalize`, { method: 'POST' })
      onProgress(100)
      return {
        sessionId: session.id,
        audioFileNames: session.files
          .filter((file) => file.kind === 'audio')
          .map((file) => file.name),
        epubFileName: session.files.find((file) => file.kind === 'epub')?.name ?? null
      }
    }
  }

  queue = {
    add: (job: Parameters<AppClient['queue']['add']>[0]) =>
      this.request<TranscriptionJob>('/api/v1/jobs', {
        method: 'POST',
        body: JSON.stringify(job)
      }),
    remove: (jobId: string) => this.request<void>(`/api/v1/jobs/${jobId}`, { method: 'DELETE' }),
    reorder: (orderedIds: string[]) =>
      this.request<void>('/api/v1/jobs/order', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds })
      }),
    cancel: (jobId: string) =>
      this.request<void>(`/api/v1/jobs/${jobId}/cancel`, { method: 'POST' }),
    pause: (jobId: string) =>
      this.request<void>(`/api/v1/jobs/${jobId}/pause`, { method: 'POST' }),
    resume: (jobId: string) =>
      this.request<void>(`/api/v1/jobs/${jobId}/resume`, { method: 'POST' }),
    retry: (jobId: string, model?: WhisperModel) =>
      this.request<TranscriptionJob>(`/api/v1/jobs/${jobId}/retry`, {
        method: 'POST',
        body: JSON.stringify({ model })
      }),
    getAll: () => this.request<TranscriptionJob[]>('/api/v1/jobs').catch(() => []),
    clearDone: () => this.request<void>('/api/v1/jobs/finished', { method: 'DELETE' }),
    onUpdated: (callback: (jobs: TranscriptionJob[]) => void): (() => void) => {
      const source = new EventSource('/api/v1/events')
      const handler = (event: MessageEvent<string>): void => {
        const data = JSON.parse(event.data) as { queue?: TranscriptionJob[] } | TranscriptionJob[]
        callback(Array.isArray(data) ? data : (data.queue ?? []))
      }
      source.addEventListener('snapshot', handler as EventListener)
      source.addEventListener('queue.updated', handler as EventListener)
      return () => source.close()
    }
  }

  abs = {
    login: (url: string, username: string, password: string) =>
      this.request<Awaited<ReturnType<AppClient['abs']['login']>>>('/api/v1/abs/login', {
        method: 'POST',
        body: JSON.stringify({ url, username, password })
      }),
    logout: () => this.request<void>('/api/v1/abs/logout', { method: 'POST' }),
    getLibraries: () => this.request<Awaited<ReturnType<AppClient['abs']['getLibraries']>>>('/api/v1/abs/libraries'),
    getBooks: (libraryId: string) =>
      this.request<Awaited<ReturnType<AppClient['abs']['getBooks']>>>(
        `/api/v1/abs/libraries/${encodeURIComponent(libraryId)}/books`
      ),
    getBook: (itemId: string) =>
      this.request<Awaited<ReturnType<AppClient['abs']['getBook']>>>(
        `/api/v1/abs/books/${encodeURIComponent(itemId)}`
      )
  }

  whisper = {
    cancel: () => this.request<void>('/api/v1/whisper/cancel', { method: 'POST' }),
    getStorageInfo: () => this.request<WhisperStorageInfo>('/api/v1/whisper/storage'),
    clearModels: () => this.request<void>('/api/v1/whisper/models', { method: 'DELETE' }),
    deleteModel: (model: WhisperModel) =>
      this.request<void>(`/api/v1/whisper/models/${model}`, { method: 'DELETE' }),
    onProgress: (): (() => void) => () => undefined
  }

  diagnostics = {
    export: async (): Promise<string | null> => {
      window.location.assign('/api/v1/diagnostics')
      return null
    }
  }

  storage = {
    getSummary: () => this.request<ManagedStorageSummary>('/api/v1/storage'),
    previewCleanup: () =>
      this.request<ManagedCleanupPreview>('/api/v1/storage/cleanup-preview', { method: 'POST' }),
    executeCleanup: (token: string) =>
      this.request<{ deletedIds: string[]; failedIds: string[] }>('/api/v1/storage/cleanup', {
        method: 'POST',
        body: JSON.stringify({ token })
      })
  }
}
