import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { _electron, expect } from '@playwright/test'

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('This smoke check requires an Apple Silicon Mac.')
}

const appPath = resolve(process.env.ABF_MAC_APP_PATH ?? 'dist/mac-arm64/Audiobook Forge.app')
const port = await new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close((error) => (error ? reject(error) : resolvePort(address.port)))
  })
})

const application = await _electron.launch({
  executablePath: `${appPath}/Contents/MacOS/Audiobook Forge`,
  env: { ...process.env, ABF_PORT: String(port) },
  timeout: 60_000
})

try {
  const page = await application.firstWindow({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Audiobook Forge', exact: true })).toBeVisible()
  const state = await page.evaluate(async () => ({
    jobs: await globalThis.electron.queue.getAll(),
    whisper: await globalThis.electron.whisper.getStorageInfo()
  }))
  assert.ok(Array.isArray(state.jobs), 'Desktop IPC queue must be available.')
  assert.equal(state.whisper.binaryReady, true, 'Bundled Whisper must be discoverable.')
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok
        } catch {
          return false
        }
      },
      { timeout: 30_000 }
    )
    .toBe(true)
  const response = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<html/i)
  console.info('Packaged Mac UI, desktop IPC, native engine discovery, and embedded server passed.')
} finally {
  await application.close()
}
