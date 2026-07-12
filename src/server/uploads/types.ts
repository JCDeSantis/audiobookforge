export type UploadFileKind = 'audio' | 'epub'
export type UploadFileState = 'uploading' | 'finalized'
export type UploadSessionState = 'open' | 'finalized' | 'abandoned'

export interface UploadFileAsset {
  id: string
  name: string
  kind: UploadFileKind
  sizeBytes: number
  lastModified: number
  offset: number
  state: UploadFileState
  path: string
  expectedSha256: string | null
  sha256: string | null
  artifactId: string | null
}

export interface UploadSession {
  id: string
  state: UploadSessionState
  files: UploadFileAsset[]
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface UploadRegistryData {
  sessions: UploadSession[]
}

export interface CreateUploadFile {
  name: string
  sizeBytes: number
  lastModified: number
  sha256?: string
}
