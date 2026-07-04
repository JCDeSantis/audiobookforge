import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import keytar from 'keytar'
import { WHISPER_MODELS } from '../whisper/models'
import { IPC } from '../../shared/types'
import { validateAbsUrl } from '../../shared/urlSafety'
import type { AppSettings, WhisperModel } from '../../shared/types'
import { readVersionedJson, writeVersionedJson } from '../../core/persistence/atomicJsonStore'
import { getDesktopDataPaths } from '../platform/desktopDataPaths'

const SERVICE = 'audiobookforge'
const LEGACY_ACCOUNT = 'abs-api-key'
const SESSION_ACCOUNT = 'abs-session'
const DEFAULT_MODEL: WhisperModel = 'large-v3-turbo-q5_0'
const SETTINGS_SCHEMA_VERSION = 1
const VALID_MODELS = new Set<WhisperModel>(WHISPER_MODELS.map((model) => model.id))

function getSettingsPath(): string {
  return getDesktopDataPaths().settingsFile
}

function getDefaultModel(model: unknown): WhisperModel {
  return typeof model === 'string' && VALID_MODELS.has(model as WhisperModel)
    ? (model as WhisperModel)
    : DEFAULT_MODEL
}

function normalizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') {
    throw new Error('Settings must be an object.')
  }

  const parsed = value as Partial<AppSettings>
  const validatedUrl = typeof parsed.absUrl === 'string' ? validateAbsUrl(parsed.absUrl) : null
  return {
    absUrl: validatedUrl && validatedUrl.ok ? validatedUrl.normalizedUrl : '',
    absUsername: typeof parsed.absUsername === 'string' ? parsed.absUsername : '',
    defaultModel: getDefaultModel(parsed.defaultModel)
  }
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<AppSettings>
  return (
    typeof settings.absUrl === 'string' &&
    (settings.absUsername === undefined || typeof settings.absUsername === 'string') &&
    typeof settings.defaultModel === 'string' &&
    VALID_MODELS.has(settings.defaultModel as WhisperModel)
  )
}

export function loadSettings(): AppSettings {
  const settingsPath = getSettingsPath()
  if (!existsSync(settingsPath)) {
    return { absUrl: '', absUsername: '', defaultModel: DEFAULT_MODEL }
  }

  return readVersionedJson({
    filePath: settingsPath,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    validate: isAppSettings,
    migrateLegacy: normalizeSettings
  }).data
}

function saveSettings(settings: AppSettings): void {
  writeVersionedJson(getSettingsPath(), SETTINGS_SCHEMA_VERSION, settings)
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
