import { openSync, readSync, closeSync } from 'fs'

// Read WAV header directly — ffmpeg always produces a standard 44-byte RIFF/PCM header.
// bytes 28-31: ByteRate (sampleRate * channels * bitsPerSample/8)
// bytes 40-43: data chunk size in bytes
// duration = dataSize / byteRate
export function readWavDuration(wavPath: string): number {
  let fd = -1
  try {
    fd = openSync(wavPath, 'r')
    const header = Buffer.alloc(44)
    readSync(fd, header, 0, 44, 0)
    const byteRate = header.readUInt32LE(28)
    const dataSize = header.readUInt32LE(40)
    if (byteRate === 0) throw new Error('invalid WAV byteRate in header')
    return dataSize / byteRate
  } finally {
    if (fd >= 0) closeSync(fd)
  }
}
