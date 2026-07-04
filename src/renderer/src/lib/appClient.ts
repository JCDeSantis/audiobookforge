import type { AppClient } from './ipc'

export function getAppClient(): AppClient {
  return window.electron
}
