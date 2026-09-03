import { resolve } from 'path'
import { copyFileSync } from 'fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { viteDefine } from './scripts/build-info.mjs'

export default defineConfig({
  main: {
    define: viteDefine()
  },
  preload: {
    define: viteDefine()
  },
  renderer: {
    define: viteDefine(),
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
          copyFileSync(resolve('src/renderer/ticket.html'), resolve('out/renderer/ticket.html'))
          copyFileSync(
            resolve('src/renderer/membership-card.html'),
            resolve('out/renderer/membership-card.html')
          )
          copyFileSync(
            resolve('src/renderer/kitchen-ticket.html'),
            resolve('out/renderer/kitchen-ticket.html')
          )
        }
      }
    ]
  }
})
