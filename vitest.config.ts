import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/renderer/src/test/setup.ts']
  }
})
