import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerFilesIpc } from './ipc/files.ipc'
import { registerAbsIpc } from './ipc/abs.ipc'
import { registerQueueIpc, setQueueWindow } from './ipc/queue.ipc'
import { registerWhisperIpc } from './ipc/whisper.ipc'
import { registerDiagnosticsIpc } from './ipc/diagnostics.ipc'
import { isSafeExternalUrl } from '../shared/urlSafety'

function getWindowIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png')
  }

  return join(app.getAppPath(), 'resources', 'icon.png')
}

function createWindow(): void {
  const expectedRendererUrl =
    !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

  const mainWindow = new BrowserWindow({
    width: 1054,
    height: 677,
    minWidth: 900,
    minHeight: 600,
    title: 'Audiobook Forge',
    icon: getWindowIconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  setQueueWindow(mainWindow)

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false)
    }
  )

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          app.isPackaged
            ? "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*"
            : "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:* http://127.0.0.1:*"
        ]
      }
    })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url) => {
    console.error(`Renderer failed to load ${url} (${errorCode}): ${errorDescription}`)
  })

  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      console.error(`[renderer:${details.level}] ${details.message}`)
    }
  })

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== expectedRendererUrl) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }

    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(expectedRendererUrl).catch((error) => {
      console.error('Failed to open the renderer URL.', error)
    })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => {
      console.error('Failed to open the packaged renderer.', error)
    })
  }
}

app.whenReady().then(() => {
  app.setName('Audiobook Forge')

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.audiobookforge.app')
  }

  registerSettingsIpc()
  registerFilesIpc()
  registerAbsIpc()
  registerQueueIpc()
  registerWhisperIpc()
  registerDiagnosticsIpc()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
