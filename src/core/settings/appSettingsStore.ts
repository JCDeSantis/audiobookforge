import { existsSync } from 'fs'
import type { AppSettings, ComputePreference, WhisperModel } from '../../shared/types'
import { isSupportedWhisperModel } from '../../shared/whisperModels'
import { validateAbsUrl } from '../../shared/urlSafety'
import { readVersionedJson, writeVersionedJson } from '../persistence/atomicJsonStore'

const SETTINGS_SCHEMA_VERSION = 1
const COMPUTE_PREFERENCES = new Set<ComputePreference>(['automatic', 'cpu'])

export const DEFAULT_APP_SETTINGS: AppSettings = {
  absUrl: '',
  absUsername: '',
  defaultModel: 'large-v3-turbo-q5_0',
  computePreference: 'automatic'
}

function normalizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') throw new Error('Settings must be an object.')
  const parsed = value as Partial<AppSettings>
  const validatedUrl = typeof parsed.absUrl === 'string' ? validateAbsUrl(parsed.absUrl) : null
  return {
    absUrl: validatedUrl?.ok ? validatedUrl.normalizedUrl : '',
    absUsername: typeof parsed.absUsername === 'string' ? parsed.absUsername : '',
    defaultModel: isSupportedWhisperModel(parsed.defaultModel)
      ? parsed.defaultModel
      : DEFAULT_APP_SETTINGS.defaultModel,
    computePreference:
      typeof parsed.computePreference === 'string' &&
      COMPUTE_PREFERENCES.has(parsed.computePreference as ComputePreference)
        ? (parsed.computePreference as ComputePreference)
        : 'automatic'
  }
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<AppSettings>
  return (
    typeof settings.absUrl === 'string' &&
    (settings.absUsername === undefined || typeof settings.absUsername === 'string') &&
    isSupportedWhisperModel(settings.defaultModel) &&
    (settings.computePreference === undefined ||
      COMPUTE_PREFERENCES.has(settings.computePreference as ComputePreference))
  )
}

export class AppSettingsStore {
  constructor(private readonly filePath: string) {}

  load(): AppSettings {
    if (!existsSync(this.filePath)) return { ...DEFAULT_APP_SETTINGS }
    return normalizeSettings(
      readVersionedJson({
        filePath: this.filePath,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        validate: isAppSettings,
        migrateLegacy: normalizeSettings
      }).data
    )
  }

  save(settings: AppSettings): AppSettings {
    const normalized = normalizeSettings(settings)
    writeVersionedJson(this.filePath, SETTINGS_SCHEMA_VERSION, normalized)
    return normalized
  }

  update(update: Partial<AppSettings>): AppSettings {
    return this.save({ ...this.load(), ...update })
  }

  setUrl(url: string): AppSettings {
    const validation = validateAbsUrl(url)
    if (!validation.ok) throw new Error(validation.error)
    return this.update({ absUrl: validation.normalizedUrl })
  }

  setDefaultModel(model: WhisperModel): AppSettings {
    if (!isSupportedWhisperModel(model)) throw new Error('Unsupported whisper model.')
    return this.update({ defaultModel: model })
  }

  setComputePreference(preference: ComputePreference): AppSettings {
    if (!COMPUTE_PREFERENCES.has(preference)) throw new Error('Unsupported compute preference.')
    return this.update({ computePreference: preference })
  }
}
