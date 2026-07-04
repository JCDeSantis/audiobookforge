import { join } from 'path'

export interface DataPaths {
  root: string
  settingsFile: string
  queueFile: string
  artifactsFile: string
  uploadsDir: string
  resultsDir: string
  tempDir: string
  checkpointsDir: string
  logsDir: string
  modelsDir: string
  binariesDir: string
}

export function createDataPaths(root: string): DataPaths {
  return {
    root,
    settingsFile: join(root, 'settings.json'),
    queueFile: join(root, 'queue.json'),
    artifactsFile: join(root, 'artifacts.json'),
    uploadsDir: join(root, 'uploads'),
    resultsDir: join(root, 'results'),
    tempDir: join(root, 'temp'),
    checkpointsDir: join(root, 'checkpoints'),
    logsDir: join(root, 'logs'),
    modelsDir: join(root, 'whisper', 'models'),
    binariesDir: join(root, 'whisper', 'bin')
  }
}
