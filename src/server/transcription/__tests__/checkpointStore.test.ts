import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ArtifactStore } from '../../../core/artifacts/artifactStore'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { ServerCheckpointStore } from '../checkpointStore'

let root = ''

describe('server transcription checkpoints', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-checkpoints-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('restores only atomically committed segments after restart', () => {
    const paths = createDataPaths(root)
    const artifacts = new ArtifactStore(paths)
    const first = new ServerCheckpointStore(paths, artifacts, 'job-1', 3)

    first.commit(0, 'completed segment')
    writeFileSync(join(first.dir, 'segment-00001.srt.tmp'), 'interrupted segment', 'utf-8')

    const restoredArtifacts = new ArtifactStore(paths)
    restoredArtifacts.load()
    const restored = new ServerCheckpointStore(paths, restoredArtifacts, 'job-1', 3)

    expect(restored.has(0)).toBe(true)
    expect(restored.read(0)).toBe('completed segment')
    expect(restored.has(1)).toBe(false)
    expect(restoredArtifacts.list()).toHaveLength(1)
    expect(restoredArtifacts.list()[0].references).toEqual(['job:job-1'])
  })

  it('invalidates completed indices when the segmentation layout changes', () => {
    const paths = createDataPaths(root)
    const artifacts = new ArtifactStore(paths)
    const first = new ServerCheckpointStore(paths, artifacts, 'job-2', 2)
    first.commit(0, 'old segment')

    const changed = new ServerCheckpointStore(paths, artifacts, 'job-2', 4)

    expect(changed.has(0)).toBe(false)
  })

  it('deletes only its managed checkpoint through confirmed cleanup', () => {
    const paths = createDataPaths(root)
    const artifacts = new ArtifactStore(paths)
    const checkpoints = new ServerCheckpointStore(paths, artifacts, 'job-3', 1)
    checkpoints.commit(0, 'done')

    checkpoints.complete()

    expect(existsSync(checkpoints.dir)).toBe(false)
    expect(artifacts.list()).toEqual([])
  })
})
