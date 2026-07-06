import { createWebServer } from './httpServer'
import { getServerRuntimeWarnings, loadServerRuntimeConfig } from './runtimeConfig'

const config = loadServerRuntimeConfig()
for (const warning of getServerRuntimeWarnings(config)) console.warn(warning)
const runtime = createWebServer(config)

runtime.server.listen(config.port, config.host, () => {
  console.info(`Audiobook Forge web server listening on ${config.host}:${config.port}`)
})

const shutdown = (): void => {
  void runtime.close().finally(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
