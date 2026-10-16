import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const electronState = vi.hoisted(() => ({ userDataPath: '', isPackaged: false }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataPath,
    get isPackaged() { return electronState.isPackaged }
  }
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

  it('returns a Windows .exe CPU binary without rejecting it', () => {
    const cpu = install('cpu')
    expect(getCpuWhisperExe()).toBe(cpu)
  })

  it('returns null for CPU when only a GPU binary is installed', () => {
    install('gpu')
    expect(getCpuWhisperExe()).toBeNull()
  })
})

describe('packaged macOS bundled binary', () => {
  let resourcesRoot = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-whisper-bin-'))
    resourcesRoot = mkdtempSync(join(tmpdir(), 'abf-resources-'))
    electronState.userDataPath = root
    electronState.isPackaged = true
    ;(process as NodeJS.Process & { resourcesPath: string }).resourcesPath = resourcesRoot
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(resourcesRoot, { recursive: true, force: true })
    electronState.isPackaged = false
  })

  it.skipIf(process.platform !== 'darwin')(
    'getCpuWhisperExe returns bundled whisper-cli when no downloaded CPU binary exists',
    () => {
      const bundledDir = join(resourcesRoot, 'whisper')
      mkdirSync(bundledDir, { recursive: true })
      const bundled = join(bundledDir, 'whisper-cli')
      writeFileSync(bundled, '')
      expect(getCpuWhisperExe()).toBe(bundled)
      expect(isBinaryDownloaded()).toBe(true)
    }
  )

  it.skipIf(process.platform !== 'darwin')(
    'getCpuWhisperExe returns bundled whisper-cli for GPU-failure CPU recovery',
    () => {
      const bundledDir = join(resourcesRoot, 'whisper')
      mkdirSync(bundledDir, { recursive: true })
      const bundled = join(bundledDir, 'whisper-cli')
      writeFileSync(bundled, '')
      // Simulates the GPU-failure recovery path: getCudaWhisperExe() returns bundled,
      // then getCpuWhisperExe() must also return it so recovery succeeds.
      expect(getCudaWhisperExe()).toBe(bundled)
      expect(getCpuWhisperExe()).toBe(bundled)
    }
  )

  it.skipIf(process.platform !== 'darwin')(
    'getCpuWhisperExe returns null when bundled whisper-cli is absent',
    () => {
      expect(getCpuWhisperExe()).toBeNull()
      expect(isBinaryDownloaded()).toBe(false)
    }
  )
})
