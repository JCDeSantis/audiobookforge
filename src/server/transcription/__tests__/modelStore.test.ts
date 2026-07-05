import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { ArtifactStore } from '../../../core/artifacts/artifactStore'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { ServerModelStore } from '../modelStore'

let root = ''

describe('server model store', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-models-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('prevents deletion while a transcription lease is active', () => {
    const paths = createDataPaths(root)
    mkdirSync(paths.modelsDir, { recursive: true })
    writeFileSync(join(paths.modelsDir, 'ggml-base.bin'), 'test-model')
    const artifacts = new ArtifactStore(paths)
    const models = new ServerModelStore(paths, artifacts)
    const release = models.acquireLease('base', 'transcription:job-1')

    expect(models.delete('base')).toBe(false)
    release()
    expect(models.delete('base')).toBe(true)
  })
})
