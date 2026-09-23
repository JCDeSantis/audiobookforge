import { createHash, timingSafeEqual } from 'crypto'
import { readFileSync } from 'fs'
import type { ServerRuntimeConfig } from '../runtimeConfig'

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf-8').digest()
}

export function loadConfiguredPassword(config: ServerRuntimeConfig): string {
  if (config.passwordFile) {
    const password = readFileSync(config.passwordFile, 'utf-8').replace(/[\r\n]+$/, '')
    if (!password) throw new Error('ABF_WEB_PASSWORD_FILE is empty.')
    return password
  }
  if (!config.password) throw new Error('The web password is not configured.')
  return config.password
}

export function verifyPassword(candidate: string, configured: string): boolean {
  return timingSafeEqual(digest(candidate), digest(configured))
}
