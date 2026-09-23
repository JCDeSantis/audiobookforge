import { existsSync, rmSync, statSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import { randomUUID } from 'crypto'
import { readVersionedJson, writeVersionedJson } from '../persistence/atomicJsonStore'
import type { DataPaths } from '../platform/dataPaths'
import type {
  ArtifactRegistryData,
  CleanupPreview,
  ManagedArtifact,
  ManagedArtifactCategory
} from './types'

const ARTIFACT_SCHEMA_VERSION = 1

export interface RegisterArtifactInput {
  id?: string
  category: ManagedArtifactCategory
  path: string
  sizeBytes?: number
  expiresAt?: number | null
  references?: string[]
}

export interface CleanupSelection {
  categories?: ManagedArtifactCategory[]
  expiredBefore?: number
  releaseReferences?: string[]
  artifactIds?: string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isManagedArtifact(value: unknown): value is ManagedArtifact {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Partial<ManagedArtifact>
  return (
    typeof artifact.id === 'string' &&
    typeof artifact.category === 'string' &&
    typeof artifact.path === 'string' &&
    typeof artifact.sizeBytes === 'number' &&
    typeof artifact.createdAt === 'number' &&
    typeof artifact.updatedAt === 'number' &&
    (artifact.expiresAt === null || typeof artifact.expiresAt === 'number') &&
    (artifact.state === 'active' || artifact.state === 'tombstoned') &&
    isStringArray(artifact.references) &&
    isStringArray(artifact.leases)
  )
}

function isArtifactRegistryData(value: unknown): value is ArtifactRegistryData {
  if (!value || typeof value !== 'object') return false
  const registry = value as Partial<ArtifactRegistryData>
  return (
    typeof registry.revision === 'number' &&
    Array.isArray(registry.artifacts) &&
    registry.artifacts.every(isManagedArtifact)
  )
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const relativePath = relative(resolve(root), resolve(candidate))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export function classifyLegacyManagedPath(
  paths: DataPaths,
  candidate: string
): ManagedArtifactCategory | null {
  const roots: Array<[string, ManagedArtifactCategory]> = [
    [paths.resultsDir, 'result'],
    [paths.tempDir, 'temporary'],
    [paths.checkpointsDir, 'checkpoint'],
    [paths.modelsDir, 'model'],
    [paths.logsDir, 'log'],
    [resolve(paths.root, 'srt'), 'result'],
    [resolve(paths.root, 'whisper', 'output'), 'temporary']
  ]

  return roots.find(([root]) => isPathInsideRoot(root, candidate))?.[1] ?? null
}

export class ArtifactStore {
  private data: ArtifactRegistryData = { revision: 0, artifacts: [] }
  private readonly previews = new Map<string, CleanupPreview & { releaseReferences: string[] }>()

  constructor(
    private readonly paths: DataPaths,
    private readonly now: () => number = Date.now
  ) {}

  load(): void {
    if (!existsSync(this.paths.artifactsFile)) {
      this.data = { revision: 0, artifacts: [] }
      return
    }

    this.data = readVersionedJson({
      filePath: this.paths.artifactsFile,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      validate: isArtifactRegistryData,
      migrateLegacy: () => {
        throw new Error('No legacy artifact registry format exists.')
      }
    }).data
  }

  list(): ManagedArtifact[] {
    return this.data.artifacts.map((artifact) => ({
      ...artifact,
      references: [...artifact.references],
      leases: [...artifact.leases]
    }))
  }

  get(artifactId: string): ManagedArtifact | null {
    const artifact = this.data.artifacts.find((entry) => entry.id === artifactId)
    return artifact
      ? { ...artifact, references: [...artifact.references], leases: [...artifact.leases] }
      : null
  }

  register(input: RegisterArtifactInput): ManagedArtifact {
    if (!isPathInsideRoot(this.paths.root, input.path)) {
      throw new Error('Managed artifacts must be inside application storage.')
    }
    const artifactPath = resolve(input.path)
    if (this.data.artifacts.some((artifact) => resolve(artifact.path) === artifactPath)) {
      throw new Error('This managed artifact path is already registered.')
    }

    const timestamp = this.now()
    const artifact: ManagedArtifact = {
      id: input.id ?? randomUUID(),
      category: input.category,
      path: artifactPath,
      sizeBytes: input.sizeBytes ?? this.readSize(artifactPath),
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: input.expiresAt ?? null,
      state: 'active',
      references: Array.from(new Set(input.references ?? [])),
      leases: []
    }
    this.data.artifacts.push(artifact)
    this.changed()
    return { ...artifact, references: [...artifact.references], leases: [] }
  }

  addReference(artifactId: string, reference: string): void {
    const artifact = this.requireArtifact(artifactId)
    if (!artifact.references.includes(reference)) {
      artifact.references.push(reference)
      artifact.updatedAt = this.now()
      this.changed()
    }
  }

  removeReference(artifactId: string, reference: string): void {
    const artifact = this.requireArtifact(artifactId)
    const next = artifact.references.filter((entry) => entry !== reference)
    if (next.length !== artifact.references.length) {
      artifact.references = next
      artifact.updatedAt = this.now()
      this.changed()
    }
  }

  acquireLease(artifactId: string, leaseId: string): void {
    const artifact = this.requireArtifact(artifactId)
    if (artifact.state !== 'active') throw new Error('Cannot lease a tombstoned artifact.')
    if (!artifact.leases.includes(leaseId)) {
      artifact.leases.push(leaseId)
      artifact.updatedAt = this.now()
      this.changed()
    }
  }

  releaseLease(artifactId: string, leaseId: string): void {
    const artifact = this.requireArtifact(artifactId)
    const next = artifact.leases.filter((entry) => entry !== leaseId)
    if (next.length !== artifact.leases.length) {
      artifact.leases = next
      artifact.updatedAt = this.now()
      this.changed()
    }
  }

  setExpiration(artifactId: string, expiresAt: number | null): void {
    const artifact = this.requireArtifact(artifactId)
    artifact.expiresAt = expiresAt
    artifact.updatedAt = this.now()
    this.changed()
  }

  previewCleanup(selection: CleanupSelection): CleanupPreview {
    const releaseReferences = Array.from(new Set(selection.releaseReferences ?? []))
    const requestedIds = selection.artifactIds ? new Set(selection.artifactIds) : null
    const requestedCategories = selection.categories ? new Set(selection.categories) : null
    const candidates = this.data.artifacts.filter((artifact) => {
      if (artifact.state !== 'active' || artifact.leases.length > 0) return false
      if (requestedIds && !requestedIds.has(artifact.id)) return false
      if (requestedCategories && !requestedCategories.has(artifact.category)) return false
      if (
        selection.expiredBefore !== undefined &&
        (artifact.expiresAt === null || artifact.expiresAt > selection.expiredBefore)
      ) {
        return false
      }
      return artifact.references.every((reference) => releaseReferences.includes(reference))
    })

    const preview: CleanupPreview & { releaseReferences: string[] } = {
      token: randomUUID(),
      revision: this.data.revision,
      artifactIds: candidates.map((artifact) => artifact.id),
      artifactCount: candidates.length,
      sizeBytes: candidates.reduce((total, artifact) => total + artifact.sizeBytes, 0),
      releaseReferences
    }
    this.previews.set(preview.token, preview)
    return {
      token: preview.token,
      revision: preview.revision,
      artifactIds: [...preview.artifactIds],
      artifactCount: preview.artifactCount,
      sizeBytes: preview.sizeBytes
    }
  }

  executeCleanup(token: string): { deletedIds: string[]; failedIds: string[] } {
    const preview = this.previews.get(token)
    this.previews.delete(token)
    if (!preview) throw new Error('Cleanup preview is missing or expired.')
    if (preview.revision !== this.data.revision) {
      throw new Error('Cleanup preview is stale; create a new preview.')
    }

    const selected = new Set(preview.artifactIds)
    for (const artifact of this.data.artifacts) {
      if (!selected.has(artifact.id)) continue
      if (artifact.leases.length > 0) throw new Error('Artifact became active during cleanup.')
      artifact.references = artifact.references.filter(
        (reference) => !preview.releaseReferences.includes(reference)
      )
      if (artifact.references.length > 0) throw new Error('Artifact is still referenced.')
      artifact.state = 'tombstoned'
      artifact.updatedAt = this.now()
    }
    this.changed()

    const deletedIds: string[] = []
    const failedIds: string[] = []
    for (const artifact of this.data.artifacts.filter((entry) => selected.has(entry.id))) {
      try {
        rmSync(artifact.path, { recursive: true, force: true })
        deletedIds.push(artifact.id)
      } catch {
        failedIds.push(artifact.id)
      }
    }

    this.data.artifacts = this.data.artifacts.filter(
      (artifact) => !deletedIds.includes(artifact.id)
    )
    this.changed()
    return { deletedIds, failedIds }
  }

  reconcileTombstones(): { deletedIds: string[]; failedIds: string[] } {
    const deletedIds: string[] = []
    const failedIds: string[] = []
    for (const artifact of this.data.artifacts.filter((entry) => entry.state === 'tombstoned')) {
      try {
        rmSync(artifact.path, { recursive: true, force: true })
        deletedIds.push(artifact.id)
      } catch {
        failedIds.push(artifact.id)
      }
    }
    if (deletedIds.length > 0) {
      this.data.artifacts = this.data.artifacts.filter(
        (artifact) => !deletedIds.includes(artifact.id)
      )
      this.changed()
    }
    return { deletedIds, failedIds }
  }

  private requireArtifact(artifactId: string): ManagedArtifact {
    const artifact = this.data.artifacts.find((entry) => entry.id === artifactId)
    if (!artifact) throw new Error('Managed artifact was not found.')
    return artifact
  }

  private readSize(path: string): number {
    try {
      return statSync(path).size
    } catch {
      return 0
    }
  }

  private changed(): void {
    this.data.revision += 1
    writeVersionedJson(this.paths.artifactsFile, ARTIFACT_SCHEMA_VERSION, this.data)
    this.previews.clear()
  }
}
