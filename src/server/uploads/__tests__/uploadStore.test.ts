import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { ArtifactStore } from '../../../core/artifacts/artifactStore'
import { UploadStore } from '../uploadStore'

let root = ''

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('resumable upload storage', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-upload-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function createStore(): UploadStore {
    const paths = createDataPaths(root)
    const artifacts = new ArtifactStore(paths, () => 1000)
    const uploads = new UploadStore(paths, artifacts, () => 1000, 1024 * 1024, 0)
    uploads.load()
    return uploads
  }

  it('validates supported multi-file sessions', () => {
    const uploads = createStore()
    expect(() =>
      uploads.create([{ name: '../book.m4b', sizeBytes: 10, lastModified: 1 }])
    ).toThrow('cannot contain paths')
    expect(() =>
      uploads.create([{ name: 'cover.jpg', sizeBytes: 10, lastModified: 1 }])
    ).toThrow('support .m4b')
    expect(() =>
      uploads.create([{ name: 'context.epub', sizeBytes: 10, lastModified: 1 }])
    ).toThrow('requires at least one audiobook')
  })

  it('resumes from acknowledged offsets and finalizes checksummed assets atomically', async () => {
    const uploads = createStore()
    const content = Buffer.from('complete audiobook bytes')
    const session = uploads.create([
      {
        name: 'book.m4b',
        sizeBytes: content.length,
        lastModified: 123,
        sha256: sha256(content)
      }
    ])
    const file = session.files[0]
    const first = content.subarray(0, 8)
    const second = content.subarray(8)

    expect(uploads.appendChunk(session.id, file.id, 0, first, sha256(first)).offset).toBe(8)
    expect(uploads.get(session.id).files[0].offset).toBe(8)
    expect(() => uploads.appendChunk(session.id, file.id, 0, second, sha256(second))).toThrow(
      'expected 8'
    )
    expect(
      uploads.appendChunk(session.id, file.id, 8, second, sha256(second)).offset
    ).toBe(content.length)

    const finalizedFile = await uploads.finalizeFile(session.id, file.id)
    expect(finalizedFile).toMatchObject({ state: 'finalized', sha256: sha256(content) })
    expect(finalizedFile.path.endsWith('.data')).toBe(true)
    expect(uploads.finalizeSession(session.id).state).toBe('finalized')
  })

  it('rejects corrupted chunks without advancing the stored offset', () => {
    const uploads = createStore()
    const session = uploads.create([{ name: 'book.mp3', sizeBytes: 5, lastModified: 1 }])
    const file = session.files[0]

    expect(() =>
      uploads.appendChunk(session.id, file.id, 0, Buffer.from('hello'), sha256(Buffer.from('nope')))
    ).toThrow('checksum mismatch')
    expect(uploads.get(session.id).files[0].offset).toBe(0)
  })
})
