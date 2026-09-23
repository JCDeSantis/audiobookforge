import { ipcMain } from 'electron'
import { IPC, type ManagedStorageSummary } from '../../shared/types'
import { getDesktopArtifactStore } from '../platform/desktopArtifacts'

export function registerStorageIpc(): void {
  ipcMain.handle(IPC.STORAGE_SUMMARY, (): ManagedStorageSummary => {
    const byCategory: ManagedStorageSummary['byCategory'] = {}
    let totalBytes = 0
    const artifacts = getDesktopArtifactStore().list().filter((artifact) => artifact.state === 'active')
    for (const artifact of artifacts) {
      totalBytes += artifact.sizeBytes
      const category = byCategory[artifact.category] ?? { bytes: 0, count: 0 }
      category.bytes += artifact.sizeBytes
      category.count += 1
      byCategory[artifact.category] = category
    }
    return { totalBytes, artifactCount: artifacts.length, byCategory }
  })

  ipcMain.handle(IPC.STORAGE_CLEANUP_PREVIEW, () => {
    const preview = getDesktopArtifactStore().previewCleanup({
      categories: ['upload-source', 'result', 'checkpoint', 'temporary', 'log']
    })
    return {
      token: preview.token,
      revision: preview.revision,
      artifactCount: preview.artifactCount,
      sizeBytes: preview.sizeBytes
    }
  })

  ipcMain.handle(IPC.STORAGE_CLEANUP_EXECUTE, (_event, token: string) => {
    if (typeof token !== 'string' || token.length < 10) {
      throw new Error('A valid cleanup preview token is required.')
    }
    return getDesktopArtifactStore().executeCleanup(token)
  })
}
