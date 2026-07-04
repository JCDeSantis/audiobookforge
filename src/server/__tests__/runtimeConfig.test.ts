import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { loadServerRuntimeConfig } from '../runtimeConfig'

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
})
