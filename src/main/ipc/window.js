import { ipcMain, BrowserWindow } from 'electron'

// The main window is frameless (`frame: false`), so the custom title-bar
// buttons are the ONLY minimise/maximise affordance — there is no OS chrome to
// fall back on. They were rendered without handlers, so neither did anything.
export function registerWindowHandlers() {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
    return { success: true }
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { success: true, maximized: win.isMaximized() }
  })
}
