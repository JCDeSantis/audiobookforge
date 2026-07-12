import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  ssr: {
    noExternal: true
  },
  build: {
    ssr: resolve('src/server/index.ts'),
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: {
        entryFileNames: 'index.mjs'
      }
    }
  }
})
