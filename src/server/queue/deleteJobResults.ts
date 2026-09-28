import type { ArtifactStore } from '../../core/artifacts/artifactStore'
import type { ServerQueue } from './serverQueue'

export function deleteJobResults(
  queue: ServerQueue,
  artifacts: ArtifactStore,
  jobId: string
): void {
  const job = queue.get(jobId)
  if (job.status !== 'done') throw new Error('Only completed job results can be deleted.')
  const ids = job.resultArtifactIds ?? []
  const reference = `job:${jobId}`
  const active = ids.flatMap((id) => {
    const artifact = artifacts.get(id)
    if (!artifact) return []
    if (artifact.category !== 'result' || !artifact.references.includes(reference)) {
      throw new Error('Result files do not belong to this job.')
    }
    if (artifact.leases.length || artifact.references.some((entry) => entry !== reference)) {
      throw new Error('Result files are in use. Wait for downloads to finish and try again.')
    }
    if (artifact.state !== 'active') throw new Error('Result cleanup is pending. Try again later.')
    return [id]
  })
  if (active.length) {
    const preview = artifacts.previewCleanup({
      artifactIds: active,
      categories: ['result'],
      releaseReferences: [reference]
    })
    const result = artifacts.executeCleanup(preview.token)
    queue.removeResultArtifacts(jobId, result.deletedIds)
    if (result.failedIds.length)
      throw new Error(
        'Some result files could not be deleted. Storage cleanup will retry; please check again later.'
      )
  }
  queue.removeResultArtifacts(jobId, ids)
}
