import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Unit tests for logic that runs without Electron's windows: settings files,
// notes, file operations, shortcuts, the file tree. Electron itself is
// mocked in the tests that need it.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
