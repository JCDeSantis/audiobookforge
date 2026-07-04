import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  PersistenceError,
  readVersionedJson,
  writeVersionedJson
} from '../atomicJsonStore'

interface ExampleData {
  name: string
}

function isExampleData(value: unknown): value is ExampleData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  )
}

let root = ''
let filePath = ''

describe('atomic versioned JSON persistence', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'abf-persistence-'))
    filePath = join(root, 'state.json')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('writes a versioned envelope and keeps the previous document as a backup', () => {
    writeVersionedJson(filePath, 1, { name: 'first' })
    writeVersionedJson(filePath, 1, { name: 'second' })

    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({
      schemaVersion: 1,
      data: { name: 'second' }
    })
    expect(JSON.parse(readFileSync(`${filePath}.bak`, 'utf-8'))).toEqual({
      schemaVersion: 1,
      data: { name: 'first' }
    })
  })

  it('migrates a legacy document once while preserving it as a backup', () => {
    writeFileSync(filePath, '{"legacyName":"legacy"}', 'utf-8')

    const result = readVersionedJson({
      filePath,
      schemaVersion: 1,
      validate: isExampleData,
      migrateLegacy: (legacy) => ({
        name: (legacy as { legacyName: string }).legacyName
      })
    })

    expect(result).toEqual({
      data: { name: 'legacy' },
      migrated: true,
      recoveredFromBackup: false
    })
    expect(JSON.parse(readFileSync(`${filePath}.bak`, 'utf-8'))).toEqual({
      legacyName: 'legacy'
    })
  })

  it('recovers the last valid document from backup without replacing the corrupt original', () => {
    writeVersionedJson(filePath, 1, { name: 'valid' })
    writeVersionedJson(filePath, 1, { name: 'newer' })
    writeFileSync(filePath, '{broken', 'utf-8')

    const result = readVersionedJson({
      filePath,
      schemaVersion: 1,
      validate: isExampleData,
      migrateLegacy: () => {
        throw new Error('not legacy')
      }
    })

    expect(result.data).toEqual({ name: 'valid' })
    expect(result.recoveredFromBackup).toBe(true)
    expect(readFileSync(filePath, 'utf-8')).toBe('{broken')
  })

  it('preserves invalid legacy input and reports migration failure', () => {
    writeFileSync(filePath, '{"unexpected":true}', 'utf-8')

    expect(() =>
      readVersionedJson({
        filePath,
        schemaVersion: 1,
        validate: isExampleData,
        migrateLegacy: () => {
          throw new Error('unsupported')
        }
      })
    ).toThrow(PersistenceError)
    expect(readFileSync(filePath, 'utf-8')).toBe('{"unexpected":true}')
    expect(existsSync(`${filePath}.bak`)).toBe(false)
  })
})
