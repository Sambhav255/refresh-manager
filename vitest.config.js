import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

// The main-process code imports from 'electron'. Under Vitest we alias that to a
// lightweight fake so the IPC handlers and DB logic can run in plain Node
// without launching Electron.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    fileParallelism: false
  },
  resolve: {
    alias: {
      electron: fileURLToPath(new URL('./test/electron-mock.js', import.meta.url))
    }
  }
})
