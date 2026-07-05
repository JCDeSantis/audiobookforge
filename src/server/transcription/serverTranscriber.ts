import { spawn, type ChildProcess } from 'child_process'
import { cpus } from 'os'
import { basename, extname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import type { DataPaths } from '../../core/platform/dataPaths'
import { ArtifactStore } from '../../core/artifacts/artifactStore'
import type {
  ComputeBackend,
  ComputePreference,
  SubtitleFormat,
  WhisperModel,
  WhisperProgressEvent
} from '../../shared/types'
import { classifyCudaFailure } from '../../shared/computeFallback'
import { convertSrtToFormat } from '../../shared/subtitleFormats'
import { ServerModelStore } from './modelStore'

interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface ServerTranscriptionResult {
  resultArtifactIds: string[]
  backend: ComputeBackend
  fallbackReason: string | null
}

export interface ServerTranscriberConfig {
  ffmpegPath: string
  whisperCpuPath: string
  whisperCudaPath: string
}

function safeBaseName(value: string): string {
  return value
    .replace(/\.(m4b|mp3)$/i, '')
    .replace(/[^a-zA-Z0-9 _.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'transcript'
}

export class ServerTranscriber {
  private activeProcess: ChildProcess | null = null

  constructor(
    private readonly paths: DataPaths,
    private readonly artifacts: ArtifactStore,
    private readonly models: ServerModelStore,
    private readonly config: ServerTranscriberConfig,
    private readonly getComputePreference: () => ComputePreference = () => 'automatic'
  ) {}

  cancel(): void {
    this.activeProcess?.kill('SIGTERM')
  }

  async transcribe(
    jobId: string,
    title: string,
    audioPaths: string[],
    model: WhisperModel,
    formats: SubtitleFormat[],
    onProgress: (progress: Omit<WhisperProgressEvent, 'jobId'>) => void,
    signal: AbortSignal
  ): Promise<ServerTranscriptionResult> {
    if (audioPaths.length === 0) throw new Error('No uploaded audio files were available.')
    const jobTemp = join(this.paths.tempDir, jobId)
    const resultDir = join(this.paths.resultsDir, jobId)
    mkdirSync(jobTemp, { recursive: true })
    mkdirSync(resultDir, { recursive: true })

    let releaseModelLease: (() => void) | null = null
    try {
      const modelPath = await this.models.ensure(
        model,
        (percent) => onProgress({ phase: 'downloading-model', percent }),
        signal
      )
      releaseModelLease = this.models.acquireLease(model, `transcription:${jobId}`)
      const listPath = join(jobTemp, 'inputs.txt')
      const wavPath = join(jobTemp, 'audio.wav')
      writeFileSync(
        listPath,
        audioPaths
          .map((path) => `file '${path.replace(/'/g, "'\\''")}'`)
          .join('\n'),
        'utf-8'
      )
      onProgress({ phase: 'preparing', percent: 0 })
      const prepared = await this.run(
        this.config.ffmpegPath,
        [
          '-hide_banner',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-ar',
          '16000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          wavPath
        ],
        signal
      )
      if (prepared.code !== 0) throw new Error(`Audio preparation failed: ${prepared.stderr.slice(-800)}`)
      onProgress({ phase: 'preparing', percent: 100 })

      const outputBase = join(jobTemp, 'transcript')
      let backend: ComputeBackend =
        this.getComputePreference() === 'cpu'
          ? 'cpu'
          : (await this.cudaAvailable(signal))
            ? 'cuda'
            : 'cpu'
      let fallbackReason: string | null = null
      let whisperResult = await this.runWhisper(
        backend === 'cuda' ? this.config.whisperCudaPath : this.config.whisperCpuPath,
        modelPath,
        wavPath,
        outputBase,
        backend,
        onProgress,
        signal
      )
      if (whisperResult.code !== 0 && backend === 'cuda') {
        fallbackReason = classifyCudaFailure(whisperResult.code, whisperResult.stderr)
        if (fallbackReason) {
          rmSync(`${outputBase}.srt`, { force: true })
          backend = 'cpu'
          onProgress({
            phase: 'transcribing',
            percent: 0,
            liveText: `CUDA ${fallbackReason}; retrying on CPU`
          })
          whisperResult = await this.runWhisper(
            this.config.whisperCpuPath,
            modelPath,
            wavPath,
            outputBase,
            'cpu',
            onProgress,
            signal
          )
        }
      }
      if (whisperResult.code !== 0) {
        throw new Error(`Whisper transcription failed: ${whisperResult.stderr.slice(-1000)}`)
      }
      const sourceSrt = `${outputBase}.srt`
      if (!existsSync(sourceSrt)) throw new Error('Whisper completed without producing subtitles.')
      const srt = readFileSync(sourceSrt, 'utf-8')
      const baseName = safeBaseName(title || basename(audioPaths[0], extname(audioPaths[0])))
      const requestedFormats = Array.from(new Set<SubtitleFormat>(['srt', ...formats]))
      const resultArtifactIds: string[] = []
      for (const format of requestedFormats) {
        const resultPath = join(resultDir, `${baseName}.${format}`)
        writeFileSync(resultPath, convertSrtToFormat(srt, format), 'utf-8')
        const artifact = this.artifacts.register({
          category: 'result',
          path: resultPath,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          references: [`job:${jobId}`]
        })
        resultArtifactIds.push(artifact.id)
      }
      onProgress({ phase: 'done', percent: 100 })
      return { resultArtifactIds, backend, fallbackReason }
    } finally {
      releaseModelLease?.()
      rmSync(jobTemp, { recursive: true, force: true })
      this.activeProcess = null
    }
  }

  private async cudaAvailable(signal: AbortSignal): Promise<boolean> {
    if (!existsSync(this.config.whisperCudaPath)) return false
    const result = await this.run('nvidia-smi', ['-L'], signal).catch(() => null)
    return result?.code === 0
  }

  private runWhisper(
    executable: string,
    modelPath: string,
    wavPath: string,
    outputBase: string,
    backend: 'cpu' | 'cuda',
    onProgress: (progress: Omit<WhisperProgressEvent, 'jobId'>) => void,
    signal: AbortSignal
  ): Promise<ProcessResult> {
    if (!existsSync(executable)) throw new Error(`Whisper ${backend} executable is unavailable.`)
    const args = [
      '-m',
      modelPath,
      '-f',
      wavPath,
      '-osrt',
      '-of',
      outputBase,
      '-l',
      'en',
      '-pp',
      '-t',
      String(Math.max(1, Math.min(cpus().length, 8)))
    ]
    if (backend === 'cpu') args.push('--no-gpu')
    return this.run(executable, args, signal, (stderr) => {
      const match = stderr.match(/progress\s*=\s*(\d+)%/)
      if (match) onProgress({ phase: 'transcribing', percent: Number(match[1]) })
    })
  }

  private run(
    executable: string,
    args: string[],
    signal: AbortSignal,
    onStderr?: (text: string) => void
  ): Promise<ProcessResult> {
    return new Promise((resolveProcess, reject) => {
      if (signal.aborted) return reject(new Error('Cancelled'))
      const process = spawn(executable, args, { windowsHide: true })
      this.activeProcess = process
      let stdout = ''
      let stderr = ''
      const abort = (): void => {
        process.kill('SIGTERM')
      }
      signal.addEventListener('abort', abort, { once: true })
      process.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderr += text
        onStderr?.(text)
      })
      process.on('error', (error) => {
        signal.removeEventListener('abort', abort)
        this.activeProcess = null
        reject(error)
      })
      process.on('close', (code) => {
        signal.removeEventListener('abort', abort)
        this.activeProcess = null
        if (signal.aborted) reject(new Error('Cancelled'))
        else resolveProcess({ code, stdout, stderr })
      })
    })
  }
}
