import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerFilesIpc } from './ipc/files.ipc'
import { registerAbsIpc } from './ipc/abs.ipc'
import { registerQueueIpc } from './ipc/queue.ipc'
import { registerWhisperIpc } from './ipc/whisper.ipc'

function getWindowIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png')
  }

  return join(app.getAppPath(), 'resources', 'icon.png')
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1054,
    height: 677,
    title: 'Audiobook Forge',
    icon: getWindowIconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Register IPC handlers — queue needs the window reference for push events
  registerSettingsIpc()
  registerFilesIpc()
  registerAbsIpc()
  registerQueueIpc(mainWindow)
  registerWhisperIpc()
}

app.whenReady().then(() => {
  app.setName('Audiobook Forge')

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.audiobookforge.app')
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
