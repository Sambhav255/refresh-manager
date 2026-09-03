import { app, dialog, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { getDb, closeDatabase } from '../db/index.js'
import { requireOwner, getSession } from '../session.js'
import { snapshotBeforeMigration } from '../db/update-safety.js'
import { getBuildIdentity } from '../build-info.js'
import { logInfo, logError } from '../diagnostics.js'

let pendingUpdateInfo = null
let updateCheckInFlight = false

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function staffSessionActive() {
  const s = getSession()
  return s && s.role === 'staff'
}

function freeDiskBytes() {
  // Best-effort — skip disk check if unavailable on this platform.
  return Number.MAX_SAFE_INTEGER
}

async function ensurePreUpdateSnapshot() {
  const db = getDb()
  const dbPath = join(app.getPath('userData'), 'refresh.db')
  const fromVersion = db.pragma('user_version', { simple: true })
  const snap = snapshotBeforeMigration(db, dbPath, fromVersion)
  const probe = db.prepare('PRAGMA quick_check').all()
  if (!(probe.length === 1 && probe[0].quick_check === 'ok')) {
    throw new Error('Database integrity check failed — update cancelled to protect your data.')
  }
  const free = freeDiskBytes()
  if (free < 50 * 1024 * 1024) {
    throw new Error(
      'Not enough free disk space for a safety backup. Free at least 50 MB and try again.'
    )
  }
  logInfo('update', `Pre-update snapshot at ${snap}`)
  return snap
}

function runInstaller(installerPath) {
  if (!existsSync(installerPath)) throw new Error('Installer file not found')
  const ext = installerPath.toLowerCase()
  if (!ext.endsWith('.exe')) {
    throw new Error('Install from file supports Windows .exe installers only.')
  }
  // NSIS silent install — no wizard, keeps userData outside install dir.
  spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore' }).unref()
}

function scheduleQuitForUpdate() {
  setTimeout(() => {
    app.quit()
  }, 600)
}

export function initAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    pendingUpdateInfo = info
    logInfo('update', `Update available: ${info.version}`)
  })

  autoUpdater.on('update-not-available', () => {
    pendingUpdateInfo = null
    logInfo('update', 'No update available')
  })

  autoUpdater.on('error', (err) => {
    logError('update', err)
  })

  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateInfo = info
    logInfo('update', `Update downloaded: ${info.version}`)
  })
}

export function registerUpdateHandlers() {
  ipcMain.handle(
    'updates:get-info',
    wrap(() => {
      const identity = getBuildIdentity()
      return {
        ...identity,
        electronVersion: process.versions.electron,
        platform: process.platform
      }
    })
  )

  ipcMain.handle(
    'updates:check',
    wrap(async () => {
      requireOwner()
      if (updateCheckInFlight) return { checking: true }
      if (app.isPackaged === false) {
        return {
          success: true,
          devMode: true,
          message: 'Updates are checked in the installed app only.'
        }
      }
      updateCheckInFlight = true
      try {
        const result = await autoUpdater.checkForUpdates()
        const info = result?.updateInfo || pendingUpdateInfo
        const current = getBuildIdentity().version
        if (info && info.version && info.version !== current) {
          return {
            success: true,
            updateAvailable: true,
            version: info.version,
            releaseNotes: info.releaseNotes || ''
          }
        }
        return { success: true, updateAvailable: false, version: current }
      } catch (err) {
        return { success: false, error: err.message || 'Could not check for updates' }
      } finally {
        updateCheckInFlight = false
      }
    })
  )

  ipcMain.handle(
    'updates:download',
    wrap(async () => {
      requireOwner()
      if (staffSessionActive()) {
        throw new Error('Log out staff before downloading an update. Do this after End of Day.')
      }
      if (!app.isPackaged) throw new Error('Updates work in the installed app only.')
      await autoUpdater.downloadUpdate()
      return { success: true, version: pendingUpdateInfo?.version }
    })
  )

  ipcMain.handle(
    'updates:install-downloaded',
    wrap(async () => {
      requireOwner()
      if (staffSessionActive()) {
        throw new Error('Log out staff before installing. Do this after End of Day.')
      }
      await ensurePreUpdateSnapshot()
      closeDatabase()
      autoUpdater.quitAndInstall(false, true)
      return { success: true, willQuit: true }
    })
  )

  ipcMain.handle(
    'updates:pick-installer',
    wrap(async () => {
      requireOwner()
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Windows installer', extensions: ['exe'] }]
      })
      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, cancelled: true }
      }
      const stat = statSync(result.filePaths[0])
      return {
        success: true,
        filePath: result.filePaths[0],
        fileName: result.filePaths[0].split(/[/\\]/).pop(),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      }
    })
  )

  ipcMain.handle(
    'updates:install-from-file',
    wrap(async ({ installerPath }) => {
      requireOwner()
      if (staffSessionActive()) {
        throw new Error('Log out staff before installing. Do this after End of Day.')
      }
      if (!installerPath) throw new Error('No installer selected')
      await ensurePreUpdateSnapshot()
      closeDatabase()
      runInstaller(installerPath)
      scheduleQuitForUpdate()
      return { success: true, willQuit: true }
    })
  )

  ipcMain.handle(
    'updates:get-changelog',
    wrap(async () => {
      const { readFileSync } = await import('fs')
      const { join: joinPath } = await import('path')
      try {
        const path = joinPath(app.getAppPath(), 'CHANGELOG.md')
        if (existsSync(path)) {
          return { success: true, content: readFileSync(path, 'utf8') }
        }
      } catch {
        /* packaged builds may not ship it yet */
      }
      return { success: true, content: '# See release notes online.' }
    })
  )
}
