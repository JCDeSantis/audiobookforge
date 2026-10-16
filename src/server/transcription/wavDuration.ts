import { openSync, readSync, closeSync, statSync } from 'fs'

export function readWavDuration(wavPath: string): number {
  let fd = -1
  try {
    fd = openSync(wavPath, 'r')

    const riff = Buffer.alloc(12)
    if (readSync(fd, riff, 0, 12, 0) < 12) throw new Error('file too short to be a WAV')
    const fourCC = riff.toString('ascii', 0, 4)
    if (fourCC === 'RF64') throw new Error('RF64 WAV format is not supported; convert to standard RIFF/WAV first')
    if (fourCC !== 'RIFF' || riff.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('not a RIFF/WAVE file')
    }

    const fileSize = statSync(wavPath).size
    let offset = 12
    let byteRate = 0
    let dataSize = 0
    let foundFmt = false
    let foundData = false

    const chunkHdr = Buffer.alloc(8)
    while (offset + 8 <= fileSize && (!foundFmt || !foundData)) {
      if (readSync(fd, chunkHdr, 0, 8, offset) < 8) break
      const id = chunkHdr.toString('ascii', 0, 4)
      const size = chunkHdr.readUInt32LE(4)

      if (id === 'fmt ') {
        const fmt = Buffer.alloc(Math.min(size, 16))
        readSync(fd, fmt, 0, fmt.length, offset + 8)
        byteRate = fmt.readUInt32LE(8)
        foundFmt = true
      } else if (id === 'data') {
        dataSize = size === 0xffffffff
          ? fileSize - offset - 8  // RF64 large-file fallback
          : size
        foundData = true
      }

      offset += 8 + size + (size % 2)
    }

    if (!foundFmt || !foundData) throw new Error('WAV file missing fmt or data chunk')
    if (byteRate === 0) throw new Error('invalid WAV byteRate in header')
    return dataSize / byteRate
  } finally {
    if (fd >= 0) closeSync(fd)
  }
}
