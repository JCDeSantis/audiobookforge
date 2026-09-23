import type { AppClient } from './ipc'
import { WebAppClient } from './webAppClient'

let webClient: WebAppClient | null = null

export function isWebRuntime(): boolean {
  return typeof window.electron === 'undefined'
}

export function getAppClient(): AppClient {
  if (!isWebRuntime()) return window.electron
  webClient ??= new WebAppClient()
  return webClient
}

export function getWebAppClient(): WebAppClient {
  if (!isWebRuntime()) throw new Error('Web authentication is unavailable in Electron.')
  webClient ??= new WebAppClient()
  return webClient
}
