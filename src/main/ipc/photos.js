import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDb } from '../db/index.js'
import { requireStaffOrOwner } from '../session.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function photosDir() {
  const dir = join(app.getPath('userData'), 'photos')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function registerPhotoHandlers() {
  ipcMain.handle(
    'photos:save',
    wrap(({ memberId, base64 }) => {
      requireStaffOrOwner()
      if (!memberId) throw new Error('memberId is required')
      if (!base64) throw new Error('Photo data is required')

      const data = base64.replace(/^data:image\/\w+;base64,/, '')
      const filePath = join(photosDir(), `${memberId}.jpg`)
      writeFileSync(filePath, Buffer.from(data, 'base64'))

      getDb().prepare(`UPDATE members SET photo_path = ? WHERE id = ?`).run(filePath, memberId)
      return { success: true, photoPath: filePath }
    })
  )

  ipcMain.handle(
    'photos:get-path',
    wrap(({ memberId }) => {
      requireStaffOrOwner()
      const row = getDb().prepare(`SELECT photo_path FROM members WHERE id = ?`).get(memberId)
      const photoPath = row?.photo_path
      if (!photoPath || !existsSync(photoPath)) {
        return { photoPath: null }
      }
      return { photoPath: `file://${photoPath}` }
    })
  )
}
