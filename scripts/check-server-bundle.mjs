import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'

const bundle = readFileSync(new URL('../dist/server/index.mjs', import.meta.url), 'utf-8')
const imports = Array.from(bundle.matchAll(/\bfrom\s+["']([^"']+)["']/g), (match) => match[1])
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const external = imports.filter((specifier) => !builtins.has(specifier))

if (external.length > 0) {
  throw new Error(`Server bundle has production package imports: ${external.join(', ')}`)
}

console.info('Server bundle contains only Node built-in imports.')
