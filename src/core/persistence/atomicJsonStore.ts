import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

export interface VersionedEnvelope<T> {
  schemaVersion: number
  data: T
}

export interface ReadVersionedResult<T> {
  data: T
  migrated: boolean
  recoveredFromBackup: boolean
}

export class PersistenceError extends Error {
  constructor(
    message: string,
    readonly filePath: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'PersistenceError'
  }
}

function isEnvelope(value: unknown): value is VersionedEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    'data' in value
  )
}

function parseJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
}

function validateData<T>(
  value: unknown,
  validate: (candidate: unknown) => candidate is T,
  filePath: string
): T {
  if (!validate(value)) {
    throw new PersistenceError('Persisted data failed validation.', filePath)
  }
  return value
}

export function writeAtomicJson<T>(filePath: string, value: T): void {
  const parent = dirname(filePath)
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const backupPath = `${filePath}.bak`
  const backupTempPath = `${backupPath}.${process.pid}.${randomUUID()}.tmp`
  mkdirSync(parent, { recursive: true })

  let descriptor: number | null = null
  try {
    descriptor = openSync(tempPath, 'wx')
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null

    if (existsSync(filePath)) {
      copyFileSync(filePath, backupTempPath)
      renameSync(backupTempPath, backupPath)
    }

    renameSync(tempPath, filePath)
  } catch (error) {
    if (descriptor !== null) {
      closeSync(descriptor)
    }
    rmSync(tempPath, { force: true })
    rmSync(backupTempPath, { force: true })
    throw new PersistenceError('Could not write persisted data atomically.', filePath, {
      cause: error
    })
  }
}

export function writeVersionedJson<T>(filePath: string, schemaVersion: number, data: T): void {
  writeAtomicJson<VersionedEnvelope<T>>(filePath, { schemaVersion, data })
}

interface ReadVersionedOptions<T> {
  filePath: string
  schemaVersion: number
  validate: (candidate: unknown) => candidate is T
  migrateLegacy: (legacy: unknown) => T
}

function readCandidate<T>(
  candidatePath: string,
  options: ReadVersionedOptions<T>
): { data: T; migrated: boolean } {
  const parsed = parseJson(candidatePath)
  if (isEnvelope(parsed)) {
    if (parsed.schemaVersion !== options.schemaVersion) {
      throw new PersistenceError(
        `Unsupported schema version ${parsed.schemaVersion}; expected ${options.schemaVersion}.`,
        candidatePath
      )
    }
    return {
      data: validateData(parsed.data, options.validate, candidatePath),
      migrated: false
    }
  }

  let migrated: T
  try {
    migrated = options.migrateLegacy(parsed)
  } catch (error) {
    throw new PersistenceError('Legacy persisted data could not be migrated.', candidatePath, {
      cause: error
    })
  }

  return {
    data: validateData(migrated, options.validate, candidatePath),
    migrated: true
  }
}

export function readVersionedJson<T>(options: ReadVersionedOptions<T>): ReadVersionedResult<T> {
  const backupPath = `${options.filePath}.bak`

  try {
    const result = readCandidate(options.filePath, options)
    if (result.migrated) {
      writeVersionedJson(options.filePath, options.schemaVersion, result.data)
    }
    return { ...result, recoveredFromBackup: false }
  } catch (primaryError) {
    if (!existsSync(backupPath)) {
      if (primaryError instanceof PersistenceError) throw primaryError
      throw new PersistenceError('Persisted data could not be read.', options.filePath, {
        cause: primaryError
      })
    }

    try {
      const result = readCandidate(backupPath, options)
      return { ...result, recoveredFromBackup: true }
    } catch (backupError) {
      throw new PersistenceError(
        'Persisted data and its backup could not be read.',
        options.filePath,
        { cause: new AggregateError([primaryError, backupError]) }
      )
    }
  }
}
