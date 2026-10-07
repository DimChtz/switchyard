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
    // Many tests run git dozens of times: on CI's Windows machines that alone can take more than the default 5s.
    testTimeout: 30_000,
    include: ['src/**/*.test.ts']
  }
})
