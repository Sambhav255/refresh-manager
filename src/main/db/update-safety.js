import { app } from 'electron'
import { join } from 'path'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'

// Update safety: before a new app version applies any pending schema migration
// to a populated production database, we take a raw file snapshot of the DB so
// a buggy migration can never lose data — if migration fails we restore the
// snapshot, and the snapshot also gives the owner a same-instant rollback
// point. These live inside userData (always writable, on the same disk as the
// live DB) — this is UPDATE safety, distinct from the configured off-site
// backups which are DISASTER recovery.

const SNAPSHOT_DIR = 'pre-update-backups'
const KEEP_SNAPSHOTS = 5

function snapshotDir() {
  const dir = join(app.getPath('userData'), SNAPSHOT_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

function prune() {
  const dir = snapshotDir()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const { f } of files.slice(KEEP_SNAPSHOTS)) {
    try {
      unlinkSync(join(dir, f))
    } catch {
      /* ignore */
    }
  }
}

// Take a consistent snapshot of the live DB file. Assumes the DB is open; a
// TRUNCATE checkpoint folds the WAL into the main file so a plain copy is
// point-in-time consistent (no writes happen this early in startup).
export function snapshotBeforeMigration(db, dbPath, fromVersion) {
  db.pragma('wal_checkpoint(TRUNCATE)')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(snapshotDir(), `refresh-preupdate-v${fromVersion}-${stamp}.db`)
  copyFileSync(dbPath, dest)
  prune()
  return dest
}

// Roll the live DB file back to a snapshot. The caller must have closed the DB
// connection first so the file can be replaced (Windows locks open files).
export function restoreSnapshot(dbPath, snapshotPath) {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`
    if (existsSync(sidecar)) {
      try {
        unlinkSync(sidecar)
      } catch {
        /* ignore */
      }
    }
  }
  copyFileSync(snapshotPath, dbPath)
}
