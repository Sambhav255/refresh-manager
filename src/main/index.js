import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import cron from 'node-cron'
import { initDatabase, getDb, isDatabaseHealthy } from './db/index.js'
import { registerAllHandlers } from './ipc/index.js'
import { performBackup } from './ipc/backup.js'
import { expireLapsedMemberships } from './ipc/maintenance.js'
import { clearSession } from './session.js'
import { initDiagnostics, logInfo, logError } from './diagnostics.js'
import { initAutoUpdater } from './ipc/updates.js'
import {
  shouldRunCatchupExport,
  writeDailyExport,
  markExportDone,
  markExportFailed
} from './daily-export.js'

let dbLossReported = false

function reportDatabaseLoss() {
  if (dbLossReported) return
  dbLossReported = true
  logError('db', 'Database connection lost at runtime')
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
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : null
    if (!url.startsWith('file:') && !(devUrl && url.startsWith(devUrl))) {
      event.preventDefault()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    clearSession()
  })

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
  const today = db.prepare(`SELECT date('now','localtime') AS d`).get().d
  return lastDate < today
}

async function runScheduledBackup() {
  try {
    const db = getDb()
    const auto = db.prepare(`SELECT value FROM settings WHERE key = 'backup_auto_enabled'`).get()
    if (auto?.value === 'false') return
    await performBackup({ skipOwnerCheck: true })
  } catch (err) {
    console.error('Scheduled backup failed:', err.message)
    logError('backup', err)
  }
}

function runCatchupExportIfNeeded() {
  try {
    const db = getDb()
    if (!shouldRunCatchupExport(db)) return
    const today = db.prepare(`SELECT date('now','localtime') AS d`).get().d
    const folder = db.prepare(`SELECT value FROM settings WHERE key = 'backup_path'`).get()?.value
    if (!folder) return
    writeDailyExport(db, folder, today)
      .then((p) => markExportDone(db, p))
      .catch(() => markExportFailed(db))
  } catch (err) {
    logError('export', err)
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
  } else {
    runCatchupExportIfNeeded()
  }
}

function startMaintenanceScheduler() {
  expireLapsedMemberships()
  cron.schedule('5 0 * * *', expireLapsedMemberships)
}

app.whenReady().then(() => {
  initDiagnostics()
  electronApp.setAppUserModelId('com.refreshrecreation.manager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    initDatabase()
  } catch (err) {
    logError('db-init', err)
    console.error('Database initialization failed:', err)
    const title = 'Refresh Manager — cannot start'
    const detail =
      err.code === 'DB_TOO_NEW' || err.code === 'MIGRATION_FAILED' || err.code === 'SNAPSHOT_FAILED'
        ? err.message
        : `Refresh Manager could not open its database.\n\n${err.message}\n\nYour data has not been changed. Please restart the app or contact support.`
    dialog.showErrorBox(title, detail)
    app.quit()
    return
  }

  registerAllHandlers()
  initAutoUpdater()
  startBackupScheduler()
  startMaintenanceScheduler()
  logInfo('app', 'startup complete — handlers registered, database ready')

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('render-process-gone', () => {
    logError('renderer', 'Render process gone')
    dialog
      .showMessageBox({
        type: 'warning',
        title: 'Refresh Manager stopped unexpectedly',
        message: 'The screen stopped working.',
        detail: 'Your sales are saved. Click Restart to reopen the app.',
        buttons: ['Restart', 'Close'],
        defaultId: 0
      })
      .then(({ response }) => {
        if (response === 0) {
          app.relaunch()
          app.exit(0)
        }
      })
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function handleFatal(err) {
  logError('uncaught', err)
  console.error('Uncaught error in main process:', err)
  if (!isDatabaseHealthy()) {
    reportDatabaseLoss()
  }
}

process.on('uncaughtException', handleFatal)
process.on('unhandledRejection', handleFatal)
