import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ArtifactStore } from '../../../core/artifacts/artifactStore'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { ServerQueue } from '../serverQueue'
import { deleteJobResults } from '../deleteJobResults'

let root = ''
describe('delete job results', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-delete-results-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function fixture(): {
    paths: ReturnType<typeof createDataPaths>
    queue: ServerQueue
    artifacts: ArtifactStore
    job: ReturnType<ServerQueue['add']>
    file: string
    other: string
  } {
    const paths = createDataPaths(root)
    const queue = new ServerQueue(paths)
    const artifacts = new ArtifactStore(paths)
    const job = queue.add({
      source: 'abs',
      title: 'Book',
      audioFiles: [],
      outputPath: null,
      absItemId: 'book',
      absLibraryId: 'library',
      absFolderId: 'folder',
      absAuthorName: 'Author',
      epubPath: null,
      model: 'base'
    })
    const file = join(root, 'result.srt')
    const other = join(root, 'other.srt')
    writeFileSync(file, 'subtitles')
    writeFileSync(other, 'other book')
    artifacts.register({
      id: 'result',
      category: 'result',
      path: file,
      references: [`job:${job.id}`]
    })
    artifacts.register({ id: 'other', category: 'result', path: other, references: ['job:other'] })
    queue.claimNext()
    queue.complete(job.id, ['result'], 'cpu', null, 'Upload could not be verified')
    return { paths, queue, artifacts, job, file, other }
  }

  it('deletes only this job’s files, keeps history and persists removal of download links', () => {
    const { paths, queue, artifacts, job, file, other } = fixture()
    deleteJobResults(queue, artifacts, job.id)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(other)).toBe(true)
    const restored = new ServerQueue(paths)
    restored.load()
    expect(restored.get(job.id)).toMatchObject({
      status: 'done',
      resultArtifactIds: [],
      resultFilesDeleted: true,
      deliveryWarning: 'Upload could not be verified'
    })
    expect(() => deleteJobResults(queue, artifacts, job.id)).not.toThrow()
  })

  it.each(['download', 'shared'])('refuses to delete files in use (%s)', (use) => {
    const { queue, artifacts, job, file } = fixture()
    if (use === 'download') artifacts.acquireLease('result', 'download:1')
    else artifacts.addReference('result', 'job:another')
    expect(() => deleteJobResults(queue, artifacts, job.id)).toThrow('in use')
    expect(existsSync(file)).toBe(true)
    expect(queue.get(job.id).resultArtifactIds).toEqual(['result'])
  })
})
