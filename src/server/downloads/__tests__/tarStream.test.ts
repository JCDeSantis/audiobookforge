import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { PassThrough } from 'stream'
import { streamTar } from '../tarStream'

let root = ''

describe('streamed TAR downloads', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-tar-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('streams named result files with complete TAR block framing', async () => {
    const path = join(root, 'result.srt')
    writeFileSync(path, 'subtitle')
    const output = new PassThrough()
    const chunks: Buffer[] = []
    output.on('data', (chunk: Buffer) => chunks.push(chunk))

    await streamTar(output as never, [{ path }])
    const archive = Buffer.concat(chunks)

    expect(archive.length % 512).toBe(0)
    expect(archive.subarray(0, 100).toString('ascii')).toContain('result.srt')
    expect(archive.toString('utf-8')).toContain('subtitle')
  })
})
