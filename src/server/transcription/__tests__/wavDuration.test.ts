import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readWavDuration } from '../wavDuration'

function makeWav(byteRate: number, dataSize: number): Buffer {
  const buf = Buffer.alloc(44)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)       // PCM chunk size
  buf.writeUInt16LE(1, 20)        // PCM format
  buf.writeUInt16LE(1, 22)        // channels
  buf.writeUInt32LE(byteRate, 24) // sample rate (== byteRate for 8-bit mono)
  buf.writeUInt32LE(byteRate, 28) // ByteRate
  buf.writeUInt16LE(1, 32)        // block align
  buf.writeUInt16LE(8, 34)        // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  return buf
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
    const byteRate = 44100
    const dataSize = 44100 * 10 // 10 seconds
    const path = join(root, 'test.wav')
    writeFileSync(path, makeWav(byteRate, dataSize))
    expect(readWavDuration(path)).toBeCloseTo(10, 5)
  })

  it('returns fractional seconds correctly', () => {
    const byteRate = 16000
    const dataSize = 16000 * 2.5 // 2.5 seconds
    const path = join(root, 'test.wav')
    writeFileSync(path, makeWav(byteRate, dataSize))
    expect(readWavDuration(path)).toBeCloseTo(2.5, 5)
  })

  it('throws when byteRate is zero', () => {
    const path = join(root, 'bad.wav')
    writeFileSync(path, makeWav(0, 1000))
    expect(() => readWavDuration(path)).toThrow('invalid WAV byteRate')
  })

  it('throws when file does not exist', () => {
    expect(() => readWavDuration(join(root, 'missing.wav'))).toThrow()
  })
})
