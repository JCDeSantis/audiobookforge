import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf-8'))
const packages = Object.entries(lock.packages ?? {})
  .filter(([path, metadata]) => path.startsWith('node_modules/') && metadata?.version)
  .map(([path, metadata]) => ({
    name: metadata.name ?? path.slice('node_modules/'.length),
    version: metadata.version,
    license: metadata.license ?? 'SEE PACKAGE',
    repository: metadata.repository?.url ?? metadata.repository ?? null
  }))
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))

const output = resolve(process.argv[2] ?? 'dist/THIRD_PARTY_LICENSES.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), packages }, null, 2)}\n`)
console.info(`Wrote ${packages.length} package license records to ${output}`)
