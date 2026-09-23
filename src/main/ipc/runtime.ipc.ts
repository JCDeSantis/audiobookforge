import { ipcMain } from 'electron'
import { IPC, type RuntimeCapabilities } from '../../shared/types'

const WINDOWS_DESKTOP_CAPABILITIES: RuntimeCapabilities = {
  runtime: 'windows-desktop',
  nativeFilePicker: true,
  browserUploads: false,
  nativeOutputFolder: true,
  resultDownloads: false,
  singleUser: true
}

export function registerRuntimeIpc(): void {
  ipcMain.handle(IPC.RUNTIME_CAPABILITIES, () => WINDOWS_DESKTOP_CAPABILITIES)
}
