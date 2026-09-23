import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { AppSettingsStore, DEFAULT_APP_SETTINGS } from '../appSettingsStore'

let root = ''

describe('application settings store', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-settings-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('uses shared defaults and persists server-safe compute settings', () => {
    const store = new AppSettingsStore(join(root, 'settings.json'))
    expect(store.load()).toEqual(DEFAULT_APP_SETTINGS)

    store.setDefaultModel('base')
    store.setComputePreference('cpu')

    expect(new AppSettingsStore(join(root, 'settings.json')).load()).toMatchObject({
      defaultModel: 'base',
      computePreference: 'cpu'
    })
  })

  it('rejects unsupported persisted values through the public setters', () => {
    const store = new AppSettingsStore(join(root, 'settings.json'))
    expect(() => store.setComputePreference('gpu' as never)).toThrow('Unsupported')
    expect(() => store.setDefaultModel('not-a-model' as never)).toThrow('Unsupported')
  })
})
