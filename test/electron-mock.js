// Minimal fake of the Electron API surface the main process touches, so the
// real IPC handlers can be exercised in plain Node under Vitest.
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const handlers = {}
let userDataDir = mkdtempSync(join(tmpdir(), 'refresh-test-'))

export const ipcMain = {
  handle: (channel, fn) => {
    handlers[channel] = fn
  },
  on: () => {}
}

export const app = {
  getPath: () => userDataDir,
  getVersion: () => '1.0.0-test',
  relaunch: () => {},
  exit: () => {},
  quit: () => {},
  whenReady: () => Promise.resolve(),
  on: () => {},
  requestSingleInstanceLock: () => true,
  setAppUserModelId: () => {}
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true }),
  showSaveDialog: async () => ({ canceled: true }),
  showErrorBox: () => {}
}

export const shell = { openExternal: () => {} }
export const BrowserWindow = class {}
export const contextBridge = { exposeInMainWorld: () => {} }
export const ipcRenderer = { invoke: () => {} }

// --- test helpers ---
export async function __invoke(channel, payload) {
  const fn = handlers[channel]
  if (!fn) throw new Error(`No handler registered for ${channel}`)
  return fn(null, payload)
}
export function __setUserDataDir(dir) {
  userDataDir = dir
}
export function __getUserDataDir() {
  return userDataDir
}

export default { ipcMain, app, dialog, shell, BrowserWindow, contextBridge, ipcRenderer }
