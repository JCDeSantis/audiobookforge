import { ipcMain, dialog, shell } from 'electron'
import { IPC } from '../../shared/types'

export function registerFilesIpc(): void {
  ipcMain.handle(IPC.FILES_PICK_AUDIO, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Audiobook File(s)',
      filters: [{ name: 'Audiobooks', extensions: ['m4b', 'mp3'] }],
      properties: ['openFile', 'multiSelections']
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle(IPC.FILES_PICK_EPUB, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select EPUB File',
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.FILES_PICK_OUTPUT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Output Folder',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.FILES_SHOW_IN_EXPLORER, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
