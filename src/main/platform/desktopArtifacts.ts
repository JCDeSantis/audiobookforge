import {
  ArtifactStore,
  classifyLegacyManagedPath
} from '../../core/artifacts/artifactStore'
import type { ManagedArtifact, ManagedArtifactCategory } from '../../core/artifacts/types'
import { RetentionService } from '../../core/artifacts/retentionService'
import { getDesktopDataPaths } from './desktopDataPaths'

let store: ArtifactStore | null = null
let retention: RetentionService | null = null

export function initializeDesktopArtifacts(): ArtifactStore {
  if (store) return store
  store = new ArtifactStore(getDesktopDataPaths())
  store.load()
  retention = new RetentionService(store)
  retention.start()
  return store
}

export function getDesktopArtifactStore(): ArtifactStore {
  return store ?? initializeDesktopArtifacts()
}

export function stopDesktopArtifactRetention(): void {
  retention?.stop()
  retention = null
}

export function trackDesktopManagedArtifact(
  path: string,
  category?: ManagedArtifactCategory,
  expiresAt: number | null = null
): ManagedArtifact | null {
  const paths = getDesktopDataPaths()
  const managedCategory = category ?? classifyLegacyManagedPath(paths, path)
  if (!managedCategory) return null

  const artifacts = getDesktopArtifactStore()
  const existing = artifacts.list().find((artifact) => artifact.path === path)
  if (existing) {
    if (existing.expiresAt !== expiresAt) artifacts.setExpiration(existing.id, expiresAt)
    return existing
  }
  return artifacts.register({ category: managedCategory, path, expiresAt })
}
