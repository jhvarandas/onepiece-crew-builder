import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The engine is framework-free, so its tests run in plain Node without the Nuxt runtime.
export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
