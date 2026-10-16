import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createDataPaths } from '../../../core/platform/dataPaths'
import { ArtifactStore } from '../../../core/artifacts/artifactStore'
import type { ServerModelStore } from '../modelStore'
import { ServerTranscriber } from '../serverTranscriber'
import type { ComputePreference } from '@shared/types'

let root = ''

function fmtChunk(byteRate: number): Buffer {
  const buf = Buffer.alloc(24)
  buf.write('fmt ', 0, 'ascii')
  buf.writeUInt32LE(16, 4)
  buf.writeUInt16LE(1, 8)
  buf.writeUInt16LE(1, 10)
  buf.writeUInt32LE(byteRate, 12)
  buf.writeUInt32LE(byteRate, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(8, 22)
  return buf
}

function makeWav(byteRate: number, dataSize: number): Buffer {
  const fmt = fmtChunk(byteRate)
  const data = Buffer.alloc(8 + dataSize)
  data.write('data', 0, 'ascii')
  data.writeUInt32LE(dataSize, 4)
  const bodySize = fmt.length + data.length
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + bodySize, 4)
  riff.write('WAVE', 8, 'ascii')
  return Buffer.concat([riff, fmt, data])
}

interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
}

describe('ServerTranscriber --no-gpu flag', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-transcriber-gpu-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function runOnce(preference: ComputePreference, whisperAllowGpu: boolean): Promise<string[]> {
    const dataPaths = createDataPaths(join(root, 'data'))
    mkdirSync(dataPaths.root, { recursive: true })
    const artifacts = new ArtifactStore(dataPaths)
    const whisperCli = join(root, 'whisper-cli')
    writeFileSync(whisperCli, '')
    const audioFile = join(root, 'book.wav')
    writeFileSync(audioFile, makeWav(16000, 16000 * 5))

    const models = {
      ensure: vi.fn().mockResolvedValue(join(root, 'model.bin')),
      acquireLease: vi.fn().mockReturnValue(() => undefined)
    } as unknown as ServerModelStore

    const transcriber = new ServerTranscriber(
      dataPaths,
      artifacts,
      models,
      {
        ffmpegPath: 'ffmpeg',
        ffprobePath: 'ffprobe',
        whisperCpuPath: whisperCli,
        whisperCudaPath: '',
        whisperAllowGpu
      },
      () => preference
    )

    let capturedWhisperArgs: string[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(transcriber as any, 'run').mockImplementation(async (...rawArgs: unknown[]): Promise<ProcessResult> => {
      const exe = rawArgs[0] as string
      const args = rawArgs[1] as string[]
      if (String(exe).endsWith('whisper-cli')) {
        capturedWhisperArgs = [...args]
        const ofIdx = args.indexOf('-of')
        if (ofIdx >= 0) {
          writeFileSync(`${args[ofIdx + 1]}.srt`, '1\n00:00:00,000 --> 00:00:01,000\nHello\n')
        }
      } else if (typeof args[args.length - 1] === 'string' && args[args.length - 1].endsWith('.wav')) {
        writeFileSync(args[args.length - 1], makeWav(16000, 16000 * 5))
      }
      return { code: 0, stdout: '', stderr: '' }
    })

    await transcriber.transcribe(
      'job-test', 'Test Book', [audioFile], 'tiny', ['srt'],
      () => undefined, new AbortController().signal
    )

    return capturedWhisperArgs
  }

  it('adds --no-gpu when preference is cpu even with whisperAllowGpu enabled', async () => {
    const args = await runOnce('cpu', true)
    expect(args).toContain('--no-gpu')
  })

  it('omits --no-gpu in automatic mode with whisperAllowGpu enabled (Metal path)', async () => {
    const args = await runOnce('automatic', true)
    expect(args).not.toContain('--no-gpu')
  })

  it('adds --no-gpu in automatic mode with whisperAllowGpu disabled (standard CPU)', async () => {
    const args = await runOnce('automatic', false)
    expect(args).toContain('--no-gpu')
  })
})
