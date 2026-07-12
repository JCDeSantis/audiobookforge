export type ManagedArtifactCategory =
  | 'upload-source'
  | 'result'
  | 'checkpoint'
  | 'temporary'
  | 'model'
  | 'log'

export type ManagedArtifactState = 'active' | 'tombstoned'

export interface ManagedArtifact {
  id: string
  category: ManagedArtifactCategory
  path: string
  sizeBytes: number
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  state: ManagedArtifactState
  references: string[]
  leases: string[]
}

export interface ArtifactRegistryData {
  revision: number
  artifacts: ManagedArtifact[]
}

export interface CleanupPreview {
  token: string
  revision: number
  artifactIds: string[]
  artifactCount: number
  sizeBytes: number
}
