import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve('out/renderer')
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname === '/__shutdown__') {
    response.end('ok')
    server.close(() => process.exit(0))
    return
  }
  const relativePath = normalize(pathname === '/' ? 'index.html' : pathname).replace(/^[/\\]+/, '')
  let path = join(root, relativePath)
  if (!path.startsWith(root) || !existsSync(path)) path = join(root, 'index.html')
  const body = readFileSync(path)
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
    'Content-Length': body.length
  })
  response.end(body)
})

server.listen(4173, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
