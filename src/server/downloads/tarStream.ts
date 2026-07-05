import { createReadStream, statSync } from 'fs'
import { basename } from 'path'
import type { ServerResponse } from 'http'

export interface TarEntry {
  path: string
  name?: string
}

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
  const encoded = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0').slice(-(length - 1))
  header.write(encoded, offset, length - 1, 'ascii')
  header[offset + length - 1] = 0
}

function tarHeader(entry: TarEntry): { header: Buffer; size: number } {
  const stats = statSync(entry.path)
  const name = (entry.name ?? basename(entry.path)).replace(/[^a-zA-Z0-9 _.-]/g, '_').slice(0, 100)
  const header = Buffer.alloc(512)
  header.write(name || 'result', 0, 100, 'ascii')
  writeOctal(header, 0o644, 100, 8)
  writeOctal(header, 0, 108, 8)
  writeOctal(header, 0, 116, 8)
  writeOctal(header, stats.size, 124, 12)
  writeOctal(header, stats.mtimeMs / 1000, 136, 12)
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  const checksumText = checksum.toString(8).padStart(6, '0').slice(-6)
  header.write(checksumText, 148, 6, 'ascii')
  header[154] = 0
  header[155] = 0x20
  return { header, size: stats.size }
}

async function write(response: ServerResponse, chunk: Buffer): Promise<void> {
  if (response.destroyed || response.writableEnded) throw new Error('Download connection closed.')
  if (response.write(chunk)) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      response.off('drain', onDrain)
      response.off('close', onClose)
      response.off('error', onError)
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('Download connection closed.'))
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
    response.once('error', onError)
  })
}

export async function streamTar(response: ServerResponse, entries: TarEntry[]): Promise<void> {
  for (const entry of entries) {
    const { header, size } = tarHeader(entry)
    await write(response, header)
    for await (const chunk of createReadStream(entry.path)) {
      await write(response, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const padding = (512 - (size % 512)) % 512
    if (padding) await write(response, Buffer.alloc(padding))
  }
  await write(response, Buffer.alloc(1024))
  response.end()
}
