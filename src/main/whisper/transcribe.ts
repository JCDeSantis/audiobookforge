import { spawn, ChildProcess } from 'child_process'
import { join, dirname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  statSync,
  appendFileSync
} from 'fs'
import { unlink } from 'fs/promises'
import { cpus } from 'os'
import axios from 'axios'
import { app } from 'electron'
import {
  getWhisperExe,
  isBinaryDownloaded,
  downloadBinary,
  isGpuEnabled,
  isCudaBinaryDownloaded
} from './binary'
import { getModelPath, getModelUrl, isModelDownloaded, getModelDir, WHISPER_MODELS } from './models'
import { getFfmpegPath, probeFile, sumDurations } from '../ffmpeg/probe'
import { createTempDir, createConcatListFile, cleanupTempDir } from '../ffmpeg/concat'
import {
  parseSilences,
  buildSegments,
  buildOverlappingSegments,
  dedupeSubtitleCues,
  findLargeInternalGaps,
  offsetSrtContent,
  mergeSrts,
  parseSrtContent,
  replaceCueRange,
  secondsToTimestamp,
  serializeSrtCues
} from './segments'
import { shouldPreferCueCandidate } from './candidateSelection'
import type { WhisperModel, WhisperProgressEvent } from '../../shared/types'
import type { AudioSegment, SubtitleCue } from './segments'
import { isMissingWindowsDependencyExitCode } from '../../shared/whisperExitCodes'

let activeProcess: ChildProcess | null = null
let activeAbortController: AbortController | null = null

type ProgressCallback = (progress: Omit<WhisperProgressEvent, 'jobId'>) => void

const LARGE_GAP_THRESHOLD_S = 10
const GAP_REPAIR_CONTEXT_S = 6
const WINDOW_RETRY_DURATION_S = 240
const WINDOW_RETRY_OVERLAP_S = 8
const MAX_GAP_REPAIRS_PER_SEGMENT = 6
const ENABLE_TEMP_GAP_DEBUG_LOGGING = false
const GAP_DEBUG_LOG_FILENAME = 'gap-debug.log'

let gapDebugLogPath: string | null = null
let gapDebugFileWriteDisabled = false

class WhisperSegmentProcessError extends Error {
  exitCode: number | null
  stderr: string

  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message)
    this.name = 'WhisperSegmentProcessError'
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

function hhmmssToSeconds(time: string): number {
  const parts = time.split(':').map(parseFloat)
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function getThreadCount(): number {
  return Math.max(1, Math.min(cpus().length, 8))
}

function offsetSubtitleCues(cues: SubtitleCue[], offsetSec: number): SubtitleCue[] {
  return cues.map((cue) => ({
    startSec: cue.startSec + offsetSec,
    endSec: cue.endSec + offsetSec,
    text: cue.text
  }))
}

function summarizeCueQualityForDebug(cues: SubtitleCue[]): {
  cueCount: number
  coverageSec: number
  gapCount: number
  largestGapSec: number
  gapDurationsSec: number[]
} {
  const gaps = findLargeInternalGaps(cues, LARGE_GAP_THRESHOLD_S).sort(
    (left, right) => right.durationSec - left.durationSec
  )
  return {
    cueCount: cues.length,
    coverageSec: Number(
      cues.reduce((total, cue) => total + Math.max(0, cue.endSec - cue.startSec), 0).toFixed(2)
    ),
    gapCount: gaps.length,
    largestGapSec: Number((gaps[0]?.durationSec ?? 0).toFixed(2)),
    gapDurationsSec: gaps.slice(0, 3).map((gap) => Number(gap.durationSec.toFixed(2)))
  }
}

function logGapDebug(event: string, payload: Record<string, unknown>): void {
  if (!ENABLE_TEMP_GAP_DEBUG_LOGGING) {
    return
  }

  const entry = `${new Date().toISOString()} [gap-debug] ${event} ${JSON.stringify(payload)}`
  console.info(entry)

  if (gapDebugFileWriteDisabled) {
    return
  }

  try {
    if (!gapDebugLogPath) {
      const logDir = join(app.getPath('userData'), 'logs')
      mkdirSync(logDir, { recursive: true })
      gapDebugLogPath = join(logDir, GAP_DEBUG_LOG_FILENAME)
    }

    appendFileSync(gapDebugLogPath, `${entry}\n`, 'utf-8')
  } catch (error) {
    gapDebugFileWriteDisabled = true
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[gap-debug] file logging disabled: ${reason}`)
  }
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
    logGapDebug('session-start', {
      model,
      audioFileCount: audioPaths.length,
      logPath: gapDebugLogPath ?? join(app.getPath('userData'), 'logs', GAP_DEBUG_LOG_FILENAME)
    })

    const reportBinaryDownloadProgress = (percent: number): void => {
      if (!signal.aborted) {
        onProgress({ phase: 'downloading-binary', percent })
      }
    }

    if (!isBinaryDownloaded()) {
      onProgress({ phase: 'downloading-binary', percent: 0 })
      await downloadBinary(reportBinaryDownloadProgress, signal)
    }

    if (signal.aborted) throw new Error('Cancelled')

    if (!isModelDownloaded(model)) {
      await unlink(getModelPath(model)).catch(() => {})
      onProgress({ phase: 'downloading-model', percent: 0 })
      await downloadModel(model, onProgress, signal)
    }

    if (signal.aborted) throw new Error('Cancelled')

    let gpuEnabled = isGpuEnabled()
    let binaryLooksCudaLinked = isCudaBinaryDownloaded()
    const inputDuration = await sumDurations(audioPaths)

    if (inputDuration <= 0) {
      throw new Error(
        'The audio duration resolved to 0 seconds. This usually means the ABS download URL or audio input is invalid.'
      )
    }

    if (signal.aborted) throw new Error('Cancelled')

    tempDir = await createTempDir()
    if (!tempDir) {
      throw new Error('Failed to create a temporary working directory.')
    }
    const workingTempDir = tempDir
    const listPath = await createConcatListFile(audioPaths, workingTempDir)
    const fullWavPath = join(workingTempDir, 'full.wav')

    const outputDir = join(app.getPath('userData'), 'whisper', 'output')
    mkdirSync(outputDir, { recursive: true })
    const srtBase = join(outputDir, `transcript_${Date.now()}`)
    const srtPath = `${srtBase}.srt`

    const ffmpeg = getFfmpegPath()
    let whisperExe = getWhisperExe()!
    const modelPath = getModelPath(model)
    const threads = getThreadCount()

    if (binaryLooksCudaLinked && !gpuEnabled) {
      onProgress({ phase: 'downloading-binary', percent: 0 })
      await downloadBinary(reportBinaryDownloadProgress, signal, {
        forceCpu: true,
        replaceExisting: true
      })

      if (signal.aborted) {
        throw new Error('Cancelled')
      }

      whisperExe = getWhisperExe()!
      gpuEnabled = false
      binaryLooksCudaLinked = false
    }

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

        if (inputDuration > 0) {
          const match = text.match(/time=(\d+):(\d+):(\d+)/)
          if (match) {
            const elapsed = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
            const pct = Math.min(Math.round((elapsed / inputDuration) * 100), 99)
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

    const preparedProbe = await probeFile(fullWavPath)
    const totalDuration = preparedProbe.duration > 0 ? preparedProbe.duration : inputDuration

    if (totalDuration <= 0) {
      throw new Error('The prepared audio duration resolved to 0 seconds.')
    }

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

    const transcribeWindow = async (
      fileBaseName: string,
      startSec: number,
      durationSec: number,
      progressSegment: AudioSegment,
      usePrompt: boolean
    ): Promise<string> => {
      const wavPath = join(workingTempDir, `${fileBaseName}.wav`)
      const srtBasePath = join(workingTempDir, fileBaseName)

      await new Promise<void>((resolve, reject) => {
        const extractProc = spawn(ffmpeg, [
          '-hide_banner',
          '-y',
          '-ss',
          String(startSec),
          '-t',
          String(durationSec),
          '-i',
          fullWavPath,
          '-c:a',
          'copy',
          wavPath
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

      const runWhisperWindow = async (useGpuForAttempt: boolean): Promise<void> => {
        const whisperArgs: string[] = [
          '-m',
          modelPath,
          '-f',
          wavPath,
          '-osrt',
          '-of',
          srtBasePath,
          '-l',
          'en',
          '-pp',
          '-t',
          String(threads)
        ]

        if (usePrompt && promptText) {
          whisperArgs.push('--prompt', promptText)
        }
        if (!useGpuForAttempt) {
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
              const overallElapsed = startSec + (localPct / 100) * durationSec
              const transcriptionPct = Math.min(
                Math.round((overallElapsed / totalDuration) * 100),
                99
              )
              onProgress({
                phase: 'transcribing',
                percent: transcriptionPct,
                segmentIndex: progressSegment.index,
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
              const overallElapsed = startSec + localElapsed
              const transcriptionPct = Math.min(
                Math.round((overallElapsed / totalDuration) * 100),
                99
              )

              onProgress({
                phase: 'transcribing',
                percent: transcriptionPct,
                segmentIndex: progressSegment.index,
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
                new WhisperSegmentProcessError(
                  `Whisper failed on segment ${progressSegment.index + 1} (code ${code})\n${whisperErr.slice(-800)}`,
                  code,
                  whisperErr
                )
              )
              return
            }

            if (/^error:/im.test(whisperErr)) {
              reject(
                new Error(
                  `Whisper reported an error on segment ${progressSegment.index + 1}\n${whisperErr.slice(-800)}`
                )
              )
              return
            }

            resolve()
          })

          whisperProc.on('error', (error) => {
            signal.removeEventListener('abort', onAbort)
            activeProcess = null
            reject(error)
          })
        })
      }

      try {
        await runWhisperWindow(gpuEnabled)
      } catch (error) {
        const shouldFallbackToCpu =
          error instanceof WhisperSegmentProcessError &&
          isMissingWindowsDependencyExitCode(error.exitCode)

        if (!shouldFallbackToCpu) {
          throw error
        }

        onProgress({ phase: 'downloading-binary', percent: 0 })
        await downloadBinary(reportBinaryDownloadProgress, signal, {
          forceCpu: true,
          replaceExisting: true
        })

        if (signal.aborted) {
          throw new Error('Cancelled')
        }

        const cpuWhisperExe = getWhisperExe()
        if (!cpuWhisperExe) {
          throw new Error(
            'Whisper could not start with the GPU binary, and the CPU fallback binary could not be installed.'
          )
        }

        gpuEnabled = false
        binaryLooksCudaLinked = false
        whisperExe = cpuWhisperExe

        await unlink(`${srtBasePath}.srt`).catch(() => {})
        await runWhisperWindow(false)
      }

      const srtWindowPath = `${srtBasePath}.srt`
      const rawSrt = existsSync(srtWindowPath) ? readFileSync(srtWindowPath, 'utf-8') : ''

      await unlink(wavPath).catch(() => {})

      return rawSrt
    }

    const transcribeRetryWindows = async (
      progressSegment: AudioSegment,
      windows: AudioSegment[],
      filePrefix: string
    ): Promise<SubtitleCue[]> => {
      const collectedCues: SubtitleCue[] = []

      for (const window of windows) {
        if (signal.aborted) throw new Error('Cancelled')

        const rawWindowSrt = await transcribeWindow(
          `${filePrefix}_${window.index.toString().padStart(3, '0')}`,
          progressSegment.startSec + window.startSec,
          window.durationSec,
          progressSegment,
          false
        )
        const localWindowCues = offsetSubtitleCues(parseSrtContent(rawWindowSrt), window.startSec)
        collectedCues.push(...localWindowCues)
      }

      return dedupeSubtitleCues(collectedCues)
    }

    const srtContents: string[] = []

    for (const seg of segments) {
      if (signal.aborted) throw new Error('Cancelled')

      const segPad = seg.index.toString().padStart(3, '0')
      const segmentBaseName = `segment_${segPad}`
      const baseRawSrt = await transcribeWindow(segmentBaseName, seg.startSec, seg.durationSec, seg, true)

      let bestLocalCues = parseSrtContent(baseRawSrt)
      let repairedLocalCues = bestLocalCues
      const attemptedRepairRanges = new Set<string>()
      const segmentLogContext = {
        segmentIndex: seg.index + 1,
        segmentCount: segments.length,
        segmentStartSec: Number(seg.startSec.toFixed(2)),
        segmentDurationSec: Number(seg.durationSec.toFixed(2)),
        segmentTimestamp: secondsToTimestamp(seg.startSec)
      }

      logGapDebug('segment-base', {
        ...segmentLogContext,
        base: summarizeCueQualityForDebug(bestLocalCues)
      })

      for (
        let repairCount = 0;
        repairCount < MAX_GAP_REPAIRS_PER_SEGMENT && repairedLocalCues.length > 0;
        repairCount++
      ) {
        const toRepairKey = (gapStartSec: number, gapEndSec: number): string => {
          const repairStartSec = Math.max(0, gapStartSec - GAP_REPAIR_CONTEXT_S)
          const repairEndSec = Math.min(seg.durationSec, gapEndSec + GAP_REPAIR_CONTEXT_S)
          return `${Math.floor(repairStartSec * 10)}-${Math.ceil(repairEndSec * 10)}`
        }

        const gapCandidates = findLargeInternalGaps(repairedLocalCues, LARGE_GAP_THRESHOLD_S).sort(
          (left, right) => right.durationSec - left.durationSec
        )
        const gapToRepair = gapCandidates.find((gap) => {
          const key = toRepairKey(gap.startSec, gap.endSec)
          return !attemptedRepairRanges.has(key)
        })

        if (!gapToRepair) {
          break
        }

        const repairStartSec = Math.max(0, gapToRepair.startSec - GAP_REPAIR_CONTEXT_S)
        const repairEndSec = Math.min(seg.durationSec, gapToRepair.endSec + GAP_REPAIR_CONTEXT_S)
        const repairKey = toRepairKey(gapToRepair.startSec, gapToRepair.endSec)
        attemptedRepairRanges.add(repairKey)
        logGapDebug('segment-repair-attempt', {
          ...segmentLogContext,
          repairAttempt: repairCount + 1,
          targetedGapSec: Number(gapToRepair.durationSec.toFixed(2)),
          repairWindowStartSec: Number(repairStartSec.toFixed(2)),
          repairWindowEndSec: Number(repairEndSec.toFixed(2)),
          repairWindowDurationSec: Number((repairEndSec - repairStartSec).toFixed(2))
        })
        const repairRawSrt = await transcribeWindow(
          `${segmentBaseName}_repair_${repairCount.toString().padStart(2, '0')}`,
          seg.startSec + repairStartSec,
          repairEndSec - repairStartSec,
          seg,
          false
        )
        const repairCues = offsetSubtitleCues(parseSrtContent(repairRawSrt), repairStartSec)
        if (repairCues.length === 0) {
          logGapDebug('segment-repair-empty', {
            ...segmentLogContext,
            repairAttempt: repairCount + 1,
            repairWindowStartSec: Number(repairStartSec.toFixed(2)),
            repairWindowEndSec: Number(repairEndSec.toFixed(2))
          })
          continue
        }

        const candidateRepairedCues = replaceCueRange(
          repairedLocalCues,
          repairStartSec,
          repairEndSec,
          repairCues
        )
        const shouldKeepRepair = shouldPreferCueCandidate(
          repairedLocalCues,
          candidateRepairedCues,
          LARGE_GAP_THRESHOLD_S
        )
        if (!shouldKeepRepair) {
          logGapDebug('segment-repair-rejected', {
            ...segmentLogContext,
            repairAttempt: repairCount + 1,
            reason: 'no-quality-improvement',
            current: summarizeCueQualityForDebug(repairedLocalCues),
            candidate: summarizeCueQualityForDebug(candidateRepairedCues)
          })
          continue
        }

        repairedLocalCues = candidateRepairedCues
        attemptedRepairRanges.clear()
        logGapDebug('segment-repair-updated', {
          ...segmentLogContext,
          repairAttempt: repairCount + 1,
          repaired: summarizeCueQualityForDebug(repairedLocalCues)
        })
      }

      const shouldUseRepaired = shouldPreferCueCandidate(
        bestLocalCues,
        repairedLocalCues,
        LARGE_GAP_THRESHOLD_S
      )
      logGapDebug('segment-repair-decision', {
        ...segmentLogContext,
        preferRepaired: shouldUseRepaired,
        current: summarizeCueQualityForDebug(bestLocalCues),
        repaired: summarizeCueQualityForDebug(repairedLocalCues)
      })
      if (shouldUseRepaired) {
        bestLocalCues = repairedLocalCues
      }

      if (
        bestLocalCues.length === 0 ||
        findLargeInternalGaps(bestLocalCues, LARGE_GAP_THRESHOLD_S).length > 0
      ) {
        const retryWindows = buildOverlappingSegments(
          seg.durationSec,
          WINDOW_RETRY_DURATION_S,
          WINDOW_RETRY_OVERLAP_S
        )
        const windowedCues = await transcribeRetryWindows(seg, retryWindows, `${segmentBaseName}_window`)
        const shouldUseWindowed = shouldPreferCueCandidate(
          bestLocalCues,
          windowedCues,
          LARGE_GAP_THRESHOLD_S
        )
        logGapDebug('segment-windowed-decision', {
          ...segmentLogContext,
          windowCount: retryWindows.length,
          preferWindowed: shouldUseWindowed,
          current: summarizeCueQualityForDebug(bestLocalCues),
          windowed: summarizeCueQualityForDebug(windowedCues)
        })

        if (shouldUseWindowed) {
          bestLocalCues = windowedCues
        }
      }

      logGapDebug('segment-final', {
        ...segmentLogContext,
        final: summarizeCueQualityForDebug(bestLocalCues)
      })

      if (bestLocalCues.length === 0 && seg.durationSec >= 120) {
        throw new Error(
          `Whisper produced no subtitles for segment ${seg.index + 1} near ${secondsToTimestamp(seg.startSec)}.`
        )
      }

      const finalLocalSrt = serializeSrtCues(bestLocalCues)
      if (finalLocalSrt.trim()) {
        srtContents.push(offsetSrtContent(finalLocalSrt, seg.startSec))
      }
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
