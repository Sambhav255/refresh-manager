import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import cron from 'node-cron'
import { initDatabase, getDb, isDatabaseHealthy } from './db/index.js'
import { registerAllHandlers } from './ipc/index.js'
import { performBackup } from './ipc/backup.js'
import { expireLapsedMemberships } from './ipc/maintenance.js'
import { clearSession } from './session.js'

let dbLossReported = false

// P2-2: if the database file is deleted or its disk/USB disconnects at runtime,
// surface a clear dialog instead of dying silently or freezing.
function reportDatabaseLoss() {
  if (dbLossReported) return
  dbLossReported = true
  dialog.showErrorBox(
    'Database connection lost',
    'Refresh Manager cannot reach its database file. Check that the drive it is stored on is connected, then restart the app.'
  )
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    show: false,
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    clearSession()
  })

  // P2-2: lightweight liveness probe when the window regains focus.
  mainWindow.on('focus', () => {
    if (!isDatabaseHealthy()) reportDatabaseLoss()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function shouldRunCatchupBackup(db) {
  const auto = db.prepare(`SELECT value FROM settings WHERE key = 'backup_auto_enabled'`).get()
  if (auto?.value === 'false') return false
  const pathRow = db.prepare(`SELECT value FROM settings WHERE key = 'backup_path'`).get()
  if (!pathRow?.value) return false
  const last = db.prepare(`SELECT value FROM settings WHERE key = 'last_backup_at'`).get()
  if (!last?.value) return true
  const lastDate = last.value.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return lastDate < today
}

function runScheduledBackup() {
  try {
    const db = getDb()
    const auto = db.prepare(`SELECT value FROM settings WHERE key = 'backup_auto_enabled'`).get()
    if (auto?.value === 'false') return
    performBackup({ skipOwnerCheck: true })
  } catch (err) {
    console.error('Scheduled backup failed:', err.message)
  }
}

function startBackupScheduler() {
  const db = getDb()
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'backup_schedule'`).get()
  const time = row?.value || '23:59'
  const [hour, minute] = time.split(':').map((n) => parseInt(n, 10))
  if (Number.isNaN(hour) || Number.isNaN(minute)) return

  cron.schedule(`${minute} ${hour} * * *`, runScheduledBackup)

  if (shouldRunCatchupBackup(db)) {
    runScheduledBackup()
  }
}

// P1-1: expire lapsed memberships at startup and again just after midnight.
function startMaintenanceScheduler() {
  expireLapsedMemberships()
  cron.schedule('5 0 * * *', expireLapsedMemberships)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.refreshrecreation.manager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase()
  registerAllHandlers()
  startBackupScheduler()
  startMaintenanceScheduler()

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// P2-2: never die silently. If an unexpected error escapes (often a lost DB
// handle), tell the user how to recover instead of leaving a frozen window.
function handleFatal(err) {
  console.error('Uncaught error in main process:', err)
  if (!isDatabaseHealthy()) {
    reportDatabaseLoss()
  }
}

process.on('uncaughtException', handleFatal)
process.on('unhandledRejection', handleFatal)
