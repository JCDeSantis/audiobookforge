import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const electronState = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userDataPath }
}))

import {
  getBinaryFlavorDir,
  getCpuWhisperExe,
  getCudaWhisperExe,
  getWhisperExe,
  isBinaryDownloaded,
  isCudaBinaryDownloaded
} from '../binary'

let root = ''

function install(flavor: 'cpu' | 'gpu'): string {
  const directory = getBinaryFlavorDir(flavor)
  mkdirSync(directory, { recursive: true })
  const executable = join(directory, 'whisper-cli.exe')
  writeFileSync(executable, '', 'utf-8')
  if (flavor === 'gpu') {
    writeFileSync(join(directory, 'ggml-cuda.dll'), '', 'utf-8')
  }
  return executable
}

describe('separate Whisper CPU and CUDA installations', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-whisper-bin-'))
    electronState.userDataPath = root
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps both executable flavors addressable', () => {
    const cpu = install('cpu')
    const gpu = install('gpu')

    expect(getCpuWhisperExe()).toBe(cpu)
    expect(getCudaWhisperExe()).toBe(gpu)
    expect(isBinaryDownloaded()).toBe(true)
    expect(isCudaBinaryDownloaded()).toBe(true)
  })

  it('selects CUDA only when the persisted runtime marker enables it', () => {
    const cpu = install('cpu')
    const gpu = install('gpu')
    writeFileSync(
      join(root, 'whisper', 'bin', 'gpu.json'),
      JSON.stringify({ enabled: true, flavor: 'gpu' }),
      'utf-8'
    )

    expect(getWhisperExe()).toBe(gpu)

    writeFileSync(
      join(root, 'whisper', 'bin', 'gpu.json'),
      JSON.stringify({ enabled: false, flavor: 'gpu' }),
      'utf-8'
    )
    expect(getWhisperExe()).toBe(cpu)
  })
})
