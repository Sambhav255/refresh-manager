import { app } from 'electron'
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Persistent diagnostics log. In a packaged build there is no visible terminal,
// so console output is lost — this writes app lifecycle, warnings, errors,
// uncaught exceptions and forwarded renderer errors to a dated file under
// `<userData>/logs/` that can be collected and sent back after a demo.
//
// Writes are SYNCHRONOUS (appendFileSync) on purpose: a crash-time write from an
// uncaughtException handler must land on disk before the process exits, which an
// async stream cannot guarantee. Logging is entirely best-effort — it must never
// throw into, or break, the code it is observing.

let logDir = null
let logFile = null
let initialized = false
let consolePatched = false

function resolveLogDir() {
  try {
    return join(app.getPath('userData'), 'logs')
  } catch {
    // Before the app is ready (or under a bare test harness) userData may not
    // resolve — fall back to a temp folder so early errors are still captured.
    return join(tmpdir(), 'refresh-manager-logs')
  }
}

function ensureFile() {
  if (logFile) return logFile
  logDir = resolveLogDir()
  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    /* ignore */
  }
  const day = new Date().toISOString().slice(0, 10)
  logFile = join(logDir, `diagnostics-${day}.log`)
  return logFile
}

function serialize(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// Core writer. `extra` is optional structured context appended after a `|`.
export function writeDiag(level, source, message, extra) {
  try {
    const file = ensureFile()
    let line = `${new Date().toISOString()} [${level}] [${source}] ${serialize(message)}`
    if (extra !== undefined) line += ` | ${serialize(extra)}`
    appendFileSync(file, line + '\n')
  } catch {
    /* diagnostics logging must never throw */
  }
}

export const logInfo = (source, message, extra) => writeDiag('INFO', source, message, extra)
export const logWarn = (source, message, extra) => writeDiag('WARN', source, message, extra)
export const logError = (source, message, extra) => writeDiag('ERROR', source, message, extra)

// Keep only the most recent `keep` daily log files so the folder can't grow
// unbounded on a long-running reception PC.
function pruneOldLogs(keep = 14) {
  try {
    const files = readdirSync(logDir)
      .filter((f) => f.startsWith('diagnostics-') && f.endsWith('.log'))
      .sort()
    while (files.length > keep) {
      const f = files.shift()
      try {
        unlinkSync(join(logDir, f))
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

// Call once, as early as possible after the app is ready, before the database
// is opened — so even startup/DB failures are captured.
export function initDiagnostics() {
  if (initialized) return
  initialized = true
  ensureFile()
  pruneOldLogs()

  // Mirror console.error / console.warn into the log so the many existing
  // console.* call sites throughout the main process are captured in a packaged
  // build without having to touch each one. The original console behaviour is
  // preserved for `npm run dev`.
  if (!consolePatched) {
    consolePatched = true
    const origError = console.error.bind(console)
    const origWarn = console.warn.bind(console)
    console.error = (...args) => {
      writeDiag('ERROR', 'console', args.map(serialize).join(' '))
      origError(...args)
    }
    console.warn = (...args) => {
      writeDiag('WARN', 'console', args.map(serialize).join(' '))
      origWarn(...args)
    }
  }

  let versions = {}
  try {
    versions = {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch
    }
  } catch {
    /* ignore */
  }
  writeDiag('INFO', 'app', '===== session start =====', versions)
}

export function getDiagnosticsInfo() {
  ensureFile()
  return { logDir, logFile }
}
