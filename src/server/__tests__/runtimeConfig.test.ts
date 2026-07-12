import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { getServerRuntimeWarnings, loadServerRuntimeConfig } from '../runtimeConfig'

describe('server runtime boundary', () => {
  it('creates Docker-safe defaults without Electron paths', () => {
    const config = loadServerRuntimeConfig({ ABF_WEB_PASSWORD_FILE: '/run/secrets/abf_password' })

    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(3000)
    expect(config.dataPaths.root).toBe(resolve('/data'))
    expect(config.passwordFile).toBe(resolve('/run/secrets/abf_password'))
    expect(config.trustProxy).toBe(false)
  })

  it('refuses to start without a configured single-user password', () => {
    expect(() => loadServerRuntimeConfig({})).toThrow(
      'Set ABF_WEB_PASSWORD_FILE or ABF_WEB_PASSWORD before starting the web server.'
    )
  })

  it('validates port and proxy configuration', () => {
    expect(() =>
      loadServerRuntimeConfig({ ABF_WEB_PASSWORD: 'secret', ABF_PORT: '70000' })
    ).toThrow('ABF_PORT')
    expect(() =>
      loadServerRuntimeConfig({ ABF_WEB_PASSWORD: 'secret', ABF_TRUST_PROXY: 'yes' })
    ).toThrow('ABF_TRUST_PROXY')
  })

  it('warns when the password is exposed directly through the environment', () => {
    const direct = loadServerRuntimeConfig({ ABF_WEB_PASSWORD: 'secret' })
    const secretFile = loadServerRuntimeConfig({
      ABF_WEB_PASSWORD_FILE: '/run/secrets/abf_password'
    })

    expect(getServerRuntimeWarnings(direct)).toEqual([
      expect.stringContaining('Prefer ABF_WEB_PASSWORD_FILE or a Docker secret')
    ])
    expect(getServerRuntimeWarnings(secretFile)).toEqual([])
  })

  it('parses upload and retention limits from environment settings', () => {
    const config = loadServerRuntimeConfig({
      ABF_WEB_PASSWORD: 'secret',
      ABF_MAX_UPLOAD_BYTES: '1234',
      ABF_FREE_SPACE_RESERVE_BYTES: '5678',
      ABF_UPLOAD_RETENTION_DAYS: '2',
      ABF_RESULT_RETENTION_DAYS: '3',
      ABF_CHECKPOINT_RETENTION_DAYS: '4',
      ABF_RETENTION_SWEEP_HOURS: '5'
    })

    expect(config.maxUploadBytes).toBe(1234)
    expect(config.freeSpaceReserveBytes).toBe(5678)
    expect(config.uploadRetentionMs).toBe(2 * 24 * 60 * 60 * 1000)
    expect(config.resultRetentionMs).toBe(3 * 24 * 60 * 60 * 1000)
    expect(config.checkpointRetentionMs).toBe(4 * 24 * 60 * 60 * 1000)
    expect(config.retentionSweepIntervalMs).toBe(5 * 60 * 60 * 1000)
  })
})
