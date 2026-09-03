import { ipcMain, shell } from 'electron'
import { getDiagnosticsInfo, writeDiag } from '../diagnostics.js'
import { getBuildIdentity } from '../build-info.js'

// Bridge for the renderer to record its own errors (window.onerror,
// unhandledrejection, React error boundaries) into the same diagnostics log as
// the main process, and to reveal the log folder for manual collection.
export function registerDiagnosticsHandlers() {
  ipcMain.handle('diagnostics:log', (_event, payload = {}) => {
    const { level = 'ERROR', source = 'unknown', message = '', extra } = payload || {}
    writeDiag(String(level).toUpperCase(), `renderer:${source}`, message, extra)
    return { success: true }
  })

  ipcMain.handle('diagnostics:get-info', () => {
    const { logDir, logFile } = getDiagnosticsInfo()
    return { success: true, logDir, logFile, ...getBuildIdentity() }
  })

  ipcMain.handle('diagnostics:open-folder', () => {
    const { logDir } = getDiagnosticsInfo()
    try {
      shell.openPath?.(logDir)
    } catch {
      /* ignore */
    }
    return { success: true, path: logDir }
  })
}
