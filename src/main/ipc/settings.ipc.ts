import { ipcMain, app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import keytar from 'keytar'
import { IPC } from '../../shared/types'
import type { AppSettings, WhisperModel } from '../../shared/types'

const SERVICE = 'audiobookforge'
const ACCOUNT = 'abs-api-key'

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      absUrl: parsed.absUrl ?? '',
      defaultModel: parsed.defaultModel ?? 'large-v3-turbo'
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
  await keytar.setPassword(SERVICE, ACCOUNT, key)
}

export async function loadApiKey(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT)
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return loadSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SET_URL, (_event, url: string) => {
    const settings = loadSettings()
    settings.absUrl = url
    saveSettings(settings)
  })

  ipcMain.handle(IPC.SETTINGS_SET_API_KEY, async (_event, key: string) => {
    await saveApiKey(key)
  })

  ipcMain.handle(IPC.SETTINGS_SET_DEFAULT_MODEL, (_event, model: WhisperModel) => {
    const settings = loadSettings()
    settings.defaultModel = model
    saveSettings(settings)
  })
}
