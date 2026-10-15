import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readWavDuration } from '../wavDuration'

function fmtChunk(byteRate: number): Buffer {
  const buf = Buffer.alloc(24)
  buf.write('fmt ', 0, 'ascii')
  buf.writeUInt32LE(16, 4)
  buf.writeUInt16LE(1, 8)         // PCM
  buf.writeUInt16LE(1, 10)        // mono
  buf.writeUInt32LE(byteRate, 12) // sample rate
  buf.writeUInt32LE(byteRate, 16) // ByteRate
  buf.writeUInt16LE(1, 20)        // block align
  buf.writeUInt16LE(8, 22)        // bits per sample
  return buf
}

function dataChunk(dataSize: number): Buffer {
  const buf = Buffer.alloc(8 + dataSize)
  buf.write('data', 0, 'ascii')
  buf.writeUInt32LE(dataSize, 4)
  return buf
}

function listChunk(payloadSize: number): Buffer {
  const buf = Buffer.alloc(8 + payloadSize)
  buf.write('LIST', 0, 'ascii')
  buf.writeUInt32LE(payloadSize, 4)
  buf.write('INFO', 8, 'ascii')
  return buf
}

function riffHeader(bodySize: number): Buffer {
  const buf = Buffer.alloc(12)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(4 + bodySize, 4)
  buf.write('WAVE', 8, 'ascii')
  return buf
}

function makeWav(byteRate: number, dataSize: number, extraChunksBefore?: Buffer): Buffer {
  const fmt = fmtChunk(byteRate)
  const dat = dataChunk(dataSize)
  const extra = extraChunksBefore ?? Buffer.alloc(0)
  const body = Buffer.concat([fmt, extra, dat])
  return Buffer.concat([riffHeader(body.length), body])
}

describe('readWavDuration', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-wav-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('computes duration from ByteRate and data chunk size', () => {
    const byteRate = 16000
    const path = join(root, 'test.wav')
    writeFileSync(path, makeWav(byteRate, byteRate * 10))
    expect(readWavDuration(path)).toBeCloseTo(10, 5)
  })

  it('returns fractional seconds correctly', () => {
    const byteRate = 16000
    const path = join(root, 'frac.wav')
    writeFileSync(path, makeWav(byteRate, byteRate * 2.5))
    expect(readWavDuration(path)).toBeCloseTo(2.5, 5)
  })

  it('reads correct duration when a LIST chunk precedes the data chunk', () => {
    const byteRate = 16000
    const path = join(root, 'list.wav')
    writeFileSync(path, makeWav(byteRate, byteRate * 5, listChunk(20)))
    expect(readWavDuration(path)).toBeCloseTo(5, 5)
  })

  it('throws when byteRate is zero', () => {
    const path = join(root, 'bad.wav')
    writeFileSync(path, makeWav(0, 1000))
    expect(() => readWavDuration(path)).toThrow('invalid WAV byteRate')
  })

  it('throws when file is not RIFF/WAVE', () => {
    const path = join(root, 'notawav.bin')
    writeFileSync(path, Buffer.from('not a wav file at all'))
    expect(() => readWavDuration(path)).toThrow('not a RIFF/WAVE file')
  })

  it('throws a clear error for RF64 WAV files', () => {
    const path = join(root, 'rf64.wav')
    const buf = Buffer.alloc(12)
    buf.write('RF64', 0, 'ascii')
    buf.writeUInt32LE(0xffffffff, 4)
    buf.write('WAVE', 8, 'ascii')
    writeFileSync(path, buf)
    expect(() => readWavDuration(path)).toThrow('RF64 WAV format is not supported')
  })

  it('throws when file does not exist', () => {
    expect(() => readWavDuration(join(root, 'missing.wav'))).toThrow()
  })

  it('returns duration over 20 minutes so the transcriber can produce multiple segments', () => {
    const byteRate = 32000
    const durationSec = 75 * 60
    const path = join(root, 'long.wav')
    writeFileSync(path, makeWav(byteRate, byteRate * durationSec, listChunk(12)))
    expect(readWavDuration(path)).toBeCloseTo(durationSec, 5)
  })
})
