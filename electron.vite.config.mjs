import { resolve } from 'path'
import { copyFileSync } from 'fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      {
        name: 'copy-ticket-html',
        closeBundle() {
          copyFileSync(
            resolve('src/renderer/ticket.html'),
            resolve('out/renderer/ticket.html')
          )
        }
      }
    ]
  }
})
