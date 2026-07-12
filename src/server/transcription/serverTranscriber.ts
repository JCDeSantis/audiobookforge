import { spawn, type ChildProcess } from 'child_process'
import { cpus } from 'os'
import { basename, extname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
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
import { mergeSrts, offsetSrtContent } from '../../shared/subtitleSegments'
import { ServerModelStore } from './modelStore'
import { extractEpubVocabulary } from '../../core/context/epubVocabulary'
import { ServerCheckpointStore } from './checkpointStore'
import {
  assertFreeProcessingSpace,
  estimateProcessingBytes,
  isDiskFullError
} from '../../core/storage/processingSpace'

const SEGMENT_SECONDS = 20 * 60

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
  ffprobePath: string
  whisperCpuPath: string
  whisperCudaPath: string
  resultRetentionMs?: number
  checkpointRetentionMs?: number
}

function safeBaseName(value: string): string {
  return (
    value
      .replace(/\.(m4b|mp3)$/i, '')
      .replace(/[^a-zA-Z0-9 _.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'transcript'
  )
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
    signal: AbortSignal,
    epubPath: string | null = null
  ): Promise<ServerTranscriptionResult> {
    if (audioPaths.length === 0) throw new Error('No uploaded audio files were available.')
    assertFreeProcessingSpace(
      this.paths.root,
      estimateProcessingBytes(audioPaths.map((path) => statSync(path).size))
    )
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
        audioPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n'),
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
      if (prepared.code !== 0) {
        if (isDiskFullError(prepared.stderr)) {
          throw new Error('Transcription ran out of disk space while preparing decoded audio.')
        }
        throw new Error(`Audio preparation failed: ${prepared.stderr.slice(-800)}`)
      }
      onProgress({ phase: 'preparing', percent: 100 })

      const promptText = epubPath ? await extractEpubVocabulary(epubPath) : ''
      const duration = await this.probeDuration(wavPath, signal)
      const segmentCount = Math.max(1, Math.ceil(duration / SEGMENT_SECONDS))
      const checkpoints = new ServerCheckpointStore(
        this.paths,
        this.artifacts,
        jobId,
        segmentCount,
        this.config.checkpointRetentionMs
      )
      let backend: ComputeBackend =
        this.getComputePreference() === 'cpu'
          ? 'cpu'
          : (await this.cudaAvailable(signal))
            ? 'cuda'
            : 'cpu'
      let fallbackReason: string | null = null
      const completedSrts: string[] = []
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        if (checkpoints.has(segmentIndex)) {
          completedSrts.push(checkpoints.read(segmentIndex))
          onProgress({
            phase: 'transcribing',
            percent: 100,
            overallPercent: Math.round(((segmentIndex + 1) / segmentCount) * 100),
            segmentIndex,
            segmentCount,
            liveText: 'Restored completed checkpoint'
          })
          continue
        }
        const startSeconds = segmentIndex * SEGMENT_SECONDS
        const segmentDuration = Math.min(SEGMENT_SECONDS, Math.max(0, duration - startSeconds))
        const segmentWav = join(jobTemp, `segment-${segmentIndex}.wav`)
        const outputBase = join(jobTemp, `segment-${segmentIndex}`)
        if (segmentCount === 1) {
          // The full prepared WAV is already in the correct Whisper format.
        } else {
          const extracted = await this.run(
            this.config.ffmpegPath,
            [
              '-hide_banner',
              '-y',
              '-ss',
              String(startSeconds),
              '-t',
              String(segmentDuration),
              '-i',
              wavPath,
              '-c:a',
              'pcm_s16le',
              segmentWav
            ],
            signal
          )
          if (extracted.code !== 0) {
            if (isDiskFullError(extracted.stderr)) {
              throw new Error('Transcription ran out of disk space while preparing a segment.')
            }
            throw new Error(`Audio segment preparation failed: ${extracted.stderr.slice(-800)}`)
          }
        }
        const whisperInput = segmentCount === 1 ? wavPath : segmentWav
        const progress = (event: Omit<WhisperProgressEvent, 'jobId'>): void =>
          onProgress({
            ...event,
            overallPercent: Math.round(
              ((segmentIndex + Math.max(0, Math.min(100, event.percent)) / 100) / segmentCount) *
                100
            ),
            segmentIndex,
            segmentCount
          })
        let whisperResult = await this.runWhisper(
          backend === 'cuda' ? this.config.whisperCudaPath : this.config.whisperCpuPath,
          modelPath,
          whisperInput,
          outputBase,
          backend === 'cuda' ? 'cuda' : 'cpu',
          progress,
          signal,
          promptText
        )
        if (whisperResult.code !== 0 && backend === 'cuda') {
          fallbackReason = classifyCudaFailure(whisperResult.code, whisperResult.stderr)
          if (fallbackReason) {
            rmSync(`${outputBase}.srt`, { force: true })
            backend = 'cpu'
            progress({
              phase: 'transcribing',
              percent: 0,
              liveText: `CUDA ${fallbackReason}; retrying this segment on CPU`
            })
            whisperResult = await this.runWhisper(
              this.config.whisperCpuPath,
              modelPath,
              whisperInput,
              outputBase,
              'cpu',
              progress,
              signal,
              promptText
            )
          }
        }
        if (whisperResult.code !== 0) {
          if (isDiskFullError(whisperResult.stderr)) {
            throw new Error(
              'Transcription ran out of disk space while Whisper was writing results.'
            )
          }
          throw new Error(`Whisper transcription failed: ${whisperResult.stderr.slice(-1000)}`)
        }
        const sourceSrt = `${outputBase}.srt`
        if (!existsSync(sourceSrt))
          throw new Error('Whisper completed without producing subtitles.')
        const segmentSrt = offsetSrtContent(readFileSync(sourceSrt, 'utf-8'), startSeconds)
        checkpoints.commit(segmentIndex, segmentSrt)
        completedSrts.push(segmentSrt)
        rmSync(segmentWav, { force: true })
        rmSync(sourceSrt, { force: true })
      }
      const srt = mergeSrts(completedSrts)
      const baseName = safeBaseName(title || basename(audioPaths[0], extname(audioPaths[0])))
      const requestedFormats = Array.from(new Set<SubtitleFormat>(['srt', ...formats]))
      const resultArtifactIds: string[] = []
      for (const format of requestedFormats) {
        const resultPath = join(resultDir, `${baseName}.${format}`)
        writeFileSync(resultPath, convertSrtToFormat(srt, format), 'utf-8')
        const existing = this.artifacts.list().find((artifact) => artifact.path === resultPath)
        const artifact =
          existing ??
          this.artifacts.register({
            category: 'result',
            path: resultPath,
            expiresAt: Date.now() + (this.config.resultRetentionMs ?? 30 * 24 * 60 * 60 * 1000),
            references: [`job:${jobId}`]
          })
        if (existing) this.artifacts.addReference(existing.id, `job:${jobId}`)
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

  private async probeDuration(wavPath: string, signal: AbortSignal): Promise<number> {
    const result = await this.run(
      this.config.ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        wavPath
      ],
      signal
    )
    const duration = Number.parseFloat(result.stdout.trim())
    if (result.code !== 0 || !Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Unable to determine prepared audio duration: ${result.stderr.slice(-800)}`)
    }
    return duration
  }

  private runWhisper(
    executable: string,
    modelPath: string,
    wavPath: string,
    outputBase: string,
    backend: 'cpu' | 'cuda',
    onProgress: (progress: Omit<WhisperProgressEvent, 'jobId'>) => void,
    signal: AbortSignal,
    promptText = ''
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
    if (promptText) args.push('--prompt', promptText)
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
