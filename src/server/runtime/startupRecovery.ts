import { mkdirSync, rmSync } from 'fs'
import type { DataPaths } from '../../core/platform/dataPaths'
import { isPathInsideRoot } from '../../core/artifacts/artifactStore'

export function scavengeInterruptedProcessing(paths: DataPaths): void {
  if (!isPathInsideRoot(paths.root, paths.tempDir) || paths.tempDir === paths.root) {
    throw new Error('Refusing to scavenge an unsafe temporary-data path.')
  }
  rmSync(paths.tempDir, { recursive: true, force: true })
  mkdirSync(paths.tempDir, { recursive: true })
}
