import { expect, test, type Page, type Route } from '@playwright/test'
import type { TranscriptionJob } from '../src/shared/types'

const settings = {
  absUrl: '',
  absUsername: '',
  defaultModel: 'base',
  computePreference: 'automatic'
}

function job(id: string, status: 'done' | 'failed', title: string): TranscriptionJob {
  return {
    id,
    status,
    source: 'upload',
    title,
    audioFiles: [`${title}.mp3`],
    outputPath: null,
    absItemId: null,
    absLibraryId: null,
    absFolderId: null,
    absAuthorName: null,
    epubPath: null,
    model: 'base',
    subtitleFormats: ['srt'],
    progress: null,
    srtPath: null,
    srtPaths: [],
    qualityReport: null,
    error: status === 'failed' ? 'Simulated CUDA failure' : null,
    createdAt: 1,
    startedAt: 2,
    completedAt: 3,
    uploadSessionId: 'upload-1',
    resultArtifactIds: status === 'done' ? ['result-1'] : [],
    computeBackend: status === 'done' ? 'cpu' : 'cuda'
  }
}

async function mockApi(page: Page, jobs: ReturnType<typeof job>[] = []): Promise<string[]> {
  const requests: string[] = []
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${request.method()} ${url.pathname}`
    requests.push(key)
    if (url.pathname === '/api/v1/events') return route.abort()
    if (key === 'GET /api/v1/auth/session') return route.fulfill({ status: 401, json: {} })
    if (key === 'POST /api/v1/auth/login') {
      const body = request.postDataJSON() as { password: string }
      return route.fulfill({
        status: body.password === 'browser-password' ? 200 : 401,
        json:
          body.password === 'browser-password'
            ? { csrfToken: 'csrf-test-token' }
            : { error: 'Incorrect password.' }
      })
    }
    if (key === 'GET /api/v1/settings') return route.fulfill({ json: settings })
    if (key === 'GET /api/v1/jobs') return route.fulfill({ json: jobs })
    if (key === 'GET /api/v1/capabilities') {
      return route.fulfill({
        json: {
          platform: 'web',
          browserUploads: true,
          nativeDialogs: false,
          resultDownloads: true,
          showInExplorer: false
        }
      })
    }
    if (key === 'POST /api/v1/uploads') {
      return route.fulfill({
        json: {
          id: 'upload-1',
          state: 'open',
          files: [
            {
              id: 'file-1',
              name: 'sample.mp3',
              sizeBytes: 5,
              offset: 0,
              kind: 'audio',
              state: 'open'
            }
          ]
        }
      })
    }
    if (key === 'HEAD /api/v1/uploads/upload-1/files/file-1') {
      return route.fulfill({ status: 204, headers: { 'Upload-Offset': '0' } })
    }
    if (key === 'PUT /api/v1/uploads/upload-1/files/file-1') {
      return route.fulfill({ status: 204, headers: { 'Upload-Offset': '5' } })
    }
    if (key.includes('/finalize')) return route.fulfill({ json: {} })
    if (key === 'POST /api/v1/jobs')
      return route.fulfill({ status: 201, json: job('new-job', 'done', 'sample') })
    if (key === 'POST /api/v1/jobs/failed-job/retry') {
      return route.fulfill({ status: 201, json: job('retried-job', 'done', 'Retry Book') })
    }
    if (key === 'GET /api/v1/artifacts/result-1/download') {
      return route.fulfill({
        body: 'subtitle',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename="result.srt"'
        }
      })
    }
    if (key === 'GET /api/v1/storage')
      return route.fulfill({ json: { totalBytes: 42, artifactCount: 1, byCategory: {} } })
    if (key === 'GET /api/v1/whisper/storage') {
      return route.fulfill({
        json: {
          binaryReady: true,
          binaryVersion: 'test',
          gpuEnabled: true,
          gpuDetected: false,
          modelDir: '',
          binaryDir: '',
          models: []
        }
      })
    }
    if (key === 'POST /api/v1/storage/cleanup-preview') {
      return route.fulfill({
        json: {
          token: 'cleanup-preview-token',
          artifactIds: ['old'],
          artifactCount: 1,
          totalBytes: 42,
          revision: 1
        }
      })
    }
    if (key === 'POST /api/v1/storage/cleanup')
      return route.fulfill({ json: { deletedIds: ['old'], failedIds: [] } })
    return route.fulfill({ status: 204 })
  })
  return requests
}

async function login(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Password').fill('browser-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Audiobook Forge' })).toBeVisible()
}

test('logs in, uploads an audiobook, and queues it', async ({ page }) => {
  const requests = await mockApi(page)
  await page.goto('/')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Incorrect password.')
  await page.getByLabel('Password').fill('browser-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'sample.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('audio') })
  await expect(page.getByText('sample', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Add to Queue' }).click()
  await expect(page.getByText('Choose Source', { exact: true })).toBeVisible()
  expect(requests).toContain('PUT /api/v1/uploads/upload-1/files/file-1')
  expect(requests).toContain('POST /api/v1/jobs')
})

test('downloads, retries, and cleans managed results', async ({ page }) => {
  const requests = await mockApi(page, [
    job('done-job', 'done', 'Finished Book'),
    job('failed-job', 'failed', 'Retry Book')
  ])
  await login(page)
  await page.getByRole('button', { name: 'Finished (2)' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  await downloadPromise
  await page.getByRole('button', { name: 'Retry' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Preview Cleanup' }).click()
  await expect(page.getByText('Removed 1 managed file.', { exact: true })).toBeVisible()
  expect(requests).toContain('POST /api/v1/jobs/failed-job/retry')
  expect(requests).toContain('GET /api/v1/artifacts/result-1/download')
  expect(requests).toContain('POST /api/v1/storage/cleanup')
})
