import { ipcMain, app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import keytar from 'keytar'
import { WHISPER_MODELS } from '../whisper/models'
import { IPC } from '../../shared/types'
import { validateAbsUrl } from '../../shared/urlSafety'
import type { AppSettings, WhisperModel } from '../../shared/types'

const SERVICE = 'audiobookforge'
const LEGACY_ACCOUNT = 'abs-api-key'
const SESSION_ACCOUNT = 'abs-session'
const DEFAULT_MODEL: WhisperModel = 'large-v3-turbo-q5_0'
const VALID_MODELS = new Set<WhisperModel>(WHISPER_MODELS.map((model) => model.id))

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function getDefaultModel(model: unknown): WhisperModel {
  return typeof model === 'string' && VALID_MODELS.has(model as WhisperModel)
    ? (model as WhisperModel)
    : DEFAULT_MODEL
}

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const validatedUrl = typeof parsed.absUrl === 'string' ? validateAbsUrl(parsed.absUrl) : null

    return {
      absUrl: validatedUrl && validatedUrl.ok ? validatedUrl.normalizedUrl : '',
      absUsername: typeof parsed.absUsername === 'string' ? parsed.absUsername : '',
      defaultModel: getDefaultModel(parsed.defaultModel)
    }
  } catch {
    return { absUrl: '', absUsername: '', defaultModel: DEFAULT_MODEL }
  }
}

function saveSettings(settings: AppSettings): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export interface AbsSession {
  baseUrl: string
  accessToken: string
  refreshToken?: string
}

export async function saveAbsSession(session: AbsSession): Promise<void> {
  await keytar.setPassword(SERVICE, SESSION_ACCOUNT, JSON.stringify(session))
  await keytar.deletePassword(SERVICE, LEGACY_ACCOUNT)
}

export async function loadAbsSession(): Promise<AbsSession | null> {
  const raw = await keytar.getPassword(SERVICE, SESSION_ACCOUNT)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<AbsSession>
    if (typeof parsed.baseUrl !== 'string' || typeof parsed.accessToken !== 'string') return null
    return {
      baseUrl: parsed.baseUrl,
      accessToken: parsed.accessToken,
      ...(typeof parsed.refreshToken === 'string' ? { refreshToken: parsed.refreshToken } : {})
    }
  } catch {
    return null
  }
}

export async function clearAbsSession(): Promise<void> {
  await Promise.all([
    keytar.deletePassword(SERVICE, SESSION_ACCOUNT),
    keytar.deletePassword(SERVICE, LEGACY_ACCOUNT)
  ])
  const settings = loadSettings()
  settings.absUsername = ''
  saveSettings(settings)
}

export function saveAbsLoginProfile(baseUrl: string, username: string): void {
  const settings = loadSettings()
  settings.absUrl = baseUrl
  settings.absUsername = username
  saveSettings(settings)
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

  ipcMain.handle(IPC.SETTINGS_SET_DEFAULT_MODEL, (_event, model: WhisperModel) => {
    if (!VALID_MODELS.has(model)) {
      throw new Error('Unsupported whisper model.')
    }

    const settings = loadSettings()
    settings.defaultModel = model
    saveSettings(settings)
  })
}
