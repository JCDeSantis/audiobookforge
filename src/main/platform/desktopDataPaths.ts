import { app } from 'electron'
import { createDataPaths, type DataPaths } from '../../core/platform/dataPaths'

export function getDesktopDataPaths(): DataPaths {
  return createDataPaths(app.getPath('userData'))
}
