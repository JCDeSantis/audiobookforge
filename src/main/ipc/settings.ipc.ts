import { ipcMain } from 'electron'
import keytar from 'keytar'
import { IPC } from '../../shared/types'
import type { AppSettings, ComputePreference, WhisperModel } from '../../shared/types'
import { getDesktopDataPaths } from '../platform/desktopDataPaths'
import { AppSettingsStore } from '../../core/settings/appSettingsStore'

const SERVICE = 'audiobookforge'
const LEGACY_ACCOUNT = 'abs-api-key'
const SESSION_ACCOUNT = 'abs-session'
function getStore(): AppSettingsStore {
  return new AppSettingsStore(getDesktopDataPaths().settingsFile)
}

export function loadSettings(): AppSettings {
  return getStore().load()
}

function saveSettings(settings: AppSettings): void {
  getStore().save(settings)
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
    getStore().setUrl(url)
  })

  ipcMain.handle(IPC.SETTINGS_SET_DEFAULT_MODEL, (_event, model: WhisperModel) => {
    getStore().setDefaultModel(model)
  })

  ipcMain.handle(
    IPC.SETTINGS_SET_COMPUTE_PREFERENCE,
    (_event, preference: ComputePreference) => {
      getStore().setComputePreference(preference)
    }
  )
}
