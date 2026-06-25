import { app, dialog, ipcMain } from 'electron'
import { existsSync, statSync } from 'fs'
import { writeFile } from 'fs/promises'
import { hostname, platform, release, totalmem, freemem, cpus } from 'os'
import { detectNvidiaGpu, getBinDir, isBinaryDownloaded, isGpuEnabled, WHISPER_VERSION } from '../whisper/binary'
import { getModelDir, getModelPath, isModelDownloaded, WHISPER_MODELS } from '../whisper/models'
import { loadQueue } from './queue.ipc'
import { loadSettings } from './settings.ipc'
import { IPC } from '../../shared/types'

function pathSize(path: string): number {
  if (!existsSync(path)) return 0

  try {
    const stats = statSync(path)
    return stats.size
  } catch {
    return 0
  }
}

function safeOrigin(url: string): string | null {
  if (!url) return null

  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle(IPC.DIAGNOSTICS_EXPORT, async () => {
    const defaultPath = `audiobook-forge-diagnostics-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`
    const result = await dialog.showSaveDialog({
      title: 'Export Diagnostics',
      defaultPath,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const settings = loadSettings()
    const gpuDetected = await detectNvidiaGpu()
    const diagnostics = {
      generatedAt: new Date().toISOString(),
      app: {
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        userDataPath: app.getPath('userData')
      },
      system: {
        hostname,
        platform: platform(),
        release: release(),
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        freeMemoryBytes: freemem()
      },
      settings: {
        absUrlConfigured: settings.absUrl.length > 0,
        absUrlOrigin: safeOrigin(settings.absUrl),
        defaultModel: settings.defaultModel
      },
      whisper: {
        version: WHISPER_VERSION,
        binaryReady: isBinaryDownloaded(),
        binaryDir: getBinDir(),
        modelDir: getModelDir(),
        gpuDetected,
        gpuEnabled: isGpuEnabled(),
        models: WHISPER_MODELS.map((model) => ({
          id: model.id,
          name: model.name,
          expectedSizeBytes: model.sizeBytes,
          downloaded: isModelDownloaded(model.id),
          diskBytes: pathSize(getModelPath(model.id))
        }))
      },
      queue: loadQueue().map((job) => ({
        id: job.id,
        status: job.status,
        source: job.source,
        title: job.title,
        model: job.model,
        audioFileCount: job.audioFiles.length,
        hasOutputPath: Boolean(job.outputPath),
        hasAbsItemId: Boolean(job.absItemId),
        hasEpub: Boolean(job.epubPath),
        srtPathCount: job.srtPaths.length,
        qualityReport: job.qualityReport,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt
      }))
    }

    await writeFile(result.filePath, JSON.stringify(diagnostics, null, 2), 'utf-8')
    return result.filePath
  })
}
