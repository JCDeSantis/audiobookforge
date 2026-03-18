import { spawn, ChildProcess } from 'child_process'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, statSync } from 'fs'
import { unlink } from 'fs/promises'
import { cpus } from 'os'
import axios from 'axios'
import { app } from 'electron'
import { getWhisperExe, isBinaryDownloaded, downloadBinary, isGpuEnabled } from './binary'
import { getModelPath, getModelUrl, isModelDownloaded, getModelDir, WHISPER_MODELS } from './models'
import { getFfmpegPath, sumDurations } from '../ffmpeg/probe'
import { createTempDir, createConcatListFile, cleanupTempDir } from '../ffmpeg/concat'
import { parseSilences, buildSegments, offsetSrtContent, mergeSrts } from './segments'
import type { WhisperModel, WhisperProgressEvent } from '../../shared/types'

let activeProcess: ChildProcess | null = null
let activeAbortController: AbortController | null = null

type ProgressCallback = (progress: Omit<WhisperProgressEvent, 'jobId'>) => void

function hhmmssToSeconds(time: string): number {
  const parts = time.split(':').map(parseFloat)
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function getThreadCount(): number {
  return Math.max(1, Math.min(cpus().length, 8))
}

async function downloadModel(
  model: WhisperModel,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<void> {
  const modelDir = getModelDir()
  mkdirSync(modelDir, { recursive: true })

  const modelPath = getModelPath(model)
  const url = getModelUrl(model)
  const modelInfo = WHISPER_MODELS.find((entry) => entry.id === model)

  if (!modelInfo) {
    throw new Error(`Unsupported model requested: ${model}`)
  }

  const response = await axios.get(url, {
    responseType: 'stream',
    maxRedirects: 10,
    headers: { 'User-Agent': 'AudioBookForge' },
    signal
  })

  const total = parseInt(response.headers['content-length'] || '0', 10)
  let downloaded = 0

  await new Promise<void>((resolve, reject) => {
    const writer = createWriteStream(modelPath)

    const onAbort = (): void => {
      writer.destroy()
      unlink(modelPath).catch(() => {})
      reject(new Error('Cancelled'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    response.data.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100)
        onProgress({ phase: 'downloading-model', percent: pct })
      }
    })

    response.data.pipe(writer)

    writer.on('finish', () => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        unlink(modelPath).catch(() => {})
        reject(new Error('Cancelled'))
      } else {
        resolve()
      }
    })

    writer.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      unlink(modelPath).catch(() => {})
      reject(err)
    })
  })

  if (total > 0) {
    const finalSize = statSync(modelPath).size
    if (finalSize !== total) {
      await unlink(modelPath).catch(() => {})
      throw new Error('Model download was incomplete. Please try again.')
    }
  }

  if (!isModelDownloaded(model)) {
    await unlink(modelPath).catch(() => {})
    throw new Error(
      `Downloaded model size did not match the expected ${modelInfo.size}. Please try again.`
    )
  }
}

export async function transcribeAudio(
  onProgress: ProgressCallback,
  audioPaths: string[],
  model: WhisperModel,
  promptText?: string
): Promise<string> {
  activeAbortController?.abort()

  const abortController = new AbortController()
  activeAbortController = abortController
  const { signal } = abortController

  let tempDir: string | null = null

  try {
    if (!isBinaryDownloaded()) {
      onProgress({ phase: 'downloading-binary', percent: 0 })
      await downloadBinary((percent) => {
        if (!signal.aborted) {
          onProgress({ phase: 'downloading-binary', percent })
        }
      }, signal)
    }

    if (signal.aborted) throw new Error('Cancelled')

    if (!isModelDownloaded(model)) {
      await unlink(getModelPath(model)).catch(() => {})
      onProgress({ phase: 'downloading-model', percent: 0 })
      await downloadModel(model, onProgress, signal)
    }

    if (signal.aborted) throw new Error('Cancelled')

    const gpuEnabled = isGpuEnabled()
    const totalDuration = await sumDurations(audioPaths)

    if (totalDuration <= 0) {
      throw new Error(
        'The audio duration resolved to 0 seconds. This usually means the ABS download URL or audio input is invalid.'
      )
    }

    if (signal.aborted) throw new Error('Cancelled')

    tempDir = await createTempDir()
    const listPath = await createConcatListFile(audioPaths, tempDir)
    const fullWavPath = join(tempDir, 'full.wav')

    const outputDir = join(app.getPath('userData'), 'whisper', 'output')
    mkdirSync(outputDir, { recursive: true })
    const srtBase = join(outputDir, `transcript_${Date.now()}`)
    const srtPath = `${srtBase}.srt`

    const ffmpeg = getFfmpegPath()
    const whisperExe = getWhisperExe()!
    const modelPath = getModelPath(model)
    const threads = getThreadCount()

    onProgress({ phase: 'preparing', percent: 0 })

    await new Promise<void>((resolve, reject) => {
      const ffmpegProc = spawn(ffmpeg, [
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
        fullWavPath
      ])
      activeProcess = ffmpegProc

      const onAbort = (): void => {
        ffmpegProc.kill('SIGTERM')
      }

      signal.addEventListener('abort', onAbort, { once: true })

      let ffmpegErr = ''
      ffmpegProc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        ffmpegErr += text

        if (totalDuration > 0) {
          const match = text.match(/time=(\d+):(\d+):(\d+)/)
          if (match) {
            const elapsed = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
            const pct = Math.min(Math.round((elapsed / totalDuration) * 100), 99)
            onProgress({ phase: 'preparing', percent: pct })
          }
        }
      })

      ffmpegProc.on('close', (code) => {
        signal.removeEventListener('abort', onAbort)
        activeProcess = null
        if (signal.aborted) {
          resolve()
          return
        }
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Audio prep failed (${code})\n${ffmpegErr.slice(-500)}`))
        }
      })

      ffmpegProc.on('error', reject)
    })

    if (signal.aborted) throw new Error('Cancelled')

    onProgress({ phase: 'segmenting', percent: 0 })

    const silences = await new Promise<[number, number][]>((resolve, reject) => {
      const silProc = spawn(ffmpeg, [
        '-hide_banner',
        '-i',
        fullWavPath,
        '-af',
        'silencedetect=n=-35dB:d=1.2',
        '-f',
        'null',
        '-'
      ])
      activeProcess = silProc

      const onAbort = (): void => {
        silProc.kill('SIGTERM')
      }

      signal.addEventListener('abort', onAbort, { once: true })

      let stderr = ''
      silProc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      silProc.on('close', () => {
        signal.removeEventListener('abort', onAbort)
        activeProcess = null
        resolve(parseSilences(stderr))
      })

      silProc.on('error', reject)
    })

    if (signal.aborted) throw new Error('Cancelled')

    const segments = buildSegments(silences, totalDuration)
    onProgress({ phase: 'segmenting', percent: 100, segmentCount: segments.length })

    const srtContents: string[] = []

    for (const seg of segments) {
      if (signal.aborted) throw new Error('Cancelled')

      const segPad = seg.index.toString().padStart(3, '0')
      const segWavPath = join(tempDir, `segment_${segPad}.wav`)
      const segSrtBase = join(tempDir, `segment_${segPad}`)

      await new Promise<void>((resolve, reject) => {
        const extractProc = spawn(ffmpeg, [
          '-hide_banner',
          '-y',
          '-ss',
          String(seg.startSec),
          '-t',
          String(seg.durationSec),
          '-i',
          fullWavPath,
          '-c:a',
          'copy',
          segWavPath
        ])
        activeProcess = extractProc

        const onAbort = (): void => {
          extractProc.kill('SIGTERM')
        }

        signal.addEventListener('abort', onAbort, { once: true })

        extractProc.on('close', (code) => {
          signal.removeEventListener('abort', onAbort)
          activeProcess = null
          if (signal.aborted || code === 0) {
            resolve()
          } else {
            reject(new Error(`Segment extract failed (code ${code})`))
          }
        })

        extractProc.on('error', reject)
      })

      if (signal.aborted) throw new Error('Cancelled')

      const whisperArgs: string[] = [
        '-m',
        modelPath,
        '-f',
        segWavPath,
        '-osrt',
        '-of',
        segSrtBase,
        '-l',
        'en',
        '-pp',
        '-t',
        String(threads)
      ]

      if (promptText) {
        whisperArgs.push('--prompt', promptText)
      }
      if (!gpuEnabled) {
        whisperArgs.push('--no-gpu')
      }

      await new Promise<void>((resolve, reject) => {
        const whisperProc = spawn(whisperExe, whisperArgs, { cwd: dirname(whisperExe) })
        activeProcess = whisperProc

        const onAbort = (): void => {
          whisperProc.kill('SIGTERM')
        }

        signal.addEventListener('abort', onAbort, { once: true })

        let whisperErr = ''
        whisperProc.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          whisperErr += text

          const progMatch = text.match(/progress\s*=\s*(\d+)%/)
          if (progMatch) {
            const localPct = parseInt(progMatch[1], 10)
            const overallElapsed = seg.startSec + (localPct / 100) * seg.durationSec
            const transcriptionPct = Math.min(
              Math.round((overallElapsed / totalDuration) * 100),
              99
            )
            onProgress({
              phase: 'transcribing',
              percent: transcriptionPct,
              segmentIndex: seg.index,
              segmentCount: segments.length
            })
          }
        })

        const seenTimestamps = new Set<string>()
        whisperProc.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString()

          for (const line of text.split('\n')) {
            const segMatch = line.match(/\[([\d:.,]+)\s*-->\s*[\d:.,]+\]\s+(.+)/)
            if (!segMatch) continue

            const localTimestamp = segMatch[1]
            if (seenTimestamps.has(localTimestamp)) continue
            seenTimestamps.add(localTimestamp)

            const localElapsed = hhmmssToSeconds(localTimestamp.replace(',', '.'))
            const overallElapsed = seg.startSec + localElapsed
            const transcriptionPct = Math.min(
              Math.round((overallElapsed / totalDuration) * 100),
              99
            )

            onProgress({
              phase: 'transcribing',
              percent: transcriptionPct,
              segmentIndex: seg.index,
              segmentCount: segments.length,
              liveText: segMatch[2].trim()
            })
          }
        })

        whisperProc.on('close', (code) => {
          signal.removeEventListener('abort', onAbort)
          activeProcess = null

          if (signal.aborted) {
            resolve()
            return
          }

          if (code !== 0) {
            reject(
              new Error(
                `Whisper failed on segment ${seg.index + 1} (code ${code})\n${whisperErr.slice(-800)}`
              )
            )
            return
          }

          if (/^error:/im.test(whisperErr)) {
            reject(
              new Error(
                `Whisper reported an error on segment ${seg.index + 1}\n${whisperErr.slice(-800)}`
              )
            )
            return
          }

          resolve()
        })

        whisperProc.on('error', reject)
      })

      const segSrtPath = `${segSrtBase}.srt`
      if (existsSync(segSrtPath)) {
        const rawSrt = readFileSync(segSrtPath, 'utf-8')
        if (rawSrt.trim()) {
          srtContents.push(offsetSrtContent(rawSrt, seg.startSec))
        }
      }

      await unlink(segWavPath).catch(() => {})
    }

    if (srtContents.length === 0) {
      throw new Error(
        'Whisper completed without producing any subtitle text. Check the audio input and ABS download URL.'
      )
    }

    const mergedSrt = mergeSrts(srtContents)
    if (!mergedSrt.trim()) {
      throw new Error('Whisper produced an empty subtitle file.')
    }

    writeFileSync(srtPath, mergedSrt, 'utf-8')
    await unlink(fullWavPath).catch(() => {})

    onProgress({ phase: 'done', percent: 100 })
    return srtPath
  } catch (err) {
    const isCancelled = signal.aborted || (err instanceof Error && err.message === 'Cancelled')

    if (!isCancelled) {
      onProgress({
        phase: 'error',
        percent: 0,
        error: err instanceof Error ? err.message : String(err)
      })
    }

    throw err
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null
    }

    activeProcess = null
    if (tempDir) {
      cleanupTempDir(tempDir)
    }
  }
}

export function cancelTranscription(): void {
  activeAbortController?.abort()
  if (activeProcess) {
    activeProcess.kill('SIGTERM')
    activeProcess = null
  }
}
