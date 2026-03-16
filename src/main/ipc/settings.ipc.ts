import { ipcMain, app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import keytar from 'keytar'
import { WHISPER_MODELS } from '../whisper/models'
import { IPC } from '../../shared/types'
import { validateAbsUrl } from '../../shared/urlSafety'
import type { AppSettings, WhisperModel } from '../../shared/types'

const SERVICE = 'audiobookforge'
const ACCOUNT = 'abs-api-key'
const VALID_MODELS = new Set<WhisperModel>(WHISPER_MODELS.map((model) => model.id))

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function getDefaultModel(model: unknown): WhisperModel {
  return typeof model === 'string' && VALID_MODELS.has(model as WhisperModel)
    ? (model as WhisperModel)
    : 'large-v3-turbo'
}

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const validatedUrl = typeof parsed.absUrl === 'string' ? validateAbsUrl(parsed.absUrl) : null

    return {
      absUrl: validatedUrl && validatedUrl.ok ? validatedUrl.normalizedUrl : '',
      defaultModel: getDefaultModel(parsed.defaultModel)
    }
  } catch {
    return { absUrl: '', defaultModel: 'large-v3-turbo' }
  }
}

function saveSettings(settings: AppSettings): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export async function saveApiKey(key: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, key.trim())
}

export async function loadApiKey(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT)
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return loadSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SET_URL, (_event, url: string) => {
    const validation = validateAbsUrl(url)
    if (!validation.ok) {
      throw new Error(validation.error)
    }

    const settings = loadSettings()
    settings.absUrl = validation.normalizedUrl
    saveSettings(settings)
  })

  ipcMain.handle(IPC.SETTINGS_SET_API_KEY, async (_event, key: string) => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('Enter an AudioBookShelf API key before saving.')
    }

    await saveApiKey(key)
  })

  ipcMain.handle(IPC.SETTINGS_SET_DEFAULT_MODEL, (_event, model: WhisperModel) => {
    if (!VALID_MODELS.has(model)) {
      throw new Error('Unsupported whisper model.')
    }

    const settings = loadSettings()
    settings.defaultModel = model
    saveSettings(settings)
  })
}
