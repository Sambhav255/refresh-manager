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
      // Security: memberId is interpolated into a filename — coerce to a
      // positive integer and require the member to exist, so a crafted payload
      // (e.g. '../../evil') can never write outside the photos directory.
      const id = Number(memberId)
      if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid memberId')
      if (!base64) throw new Error('Photo data is required')
      const member = getDb().prepare('SELECT id FROM members WHERE id = ?').get(id)
      if (!member) throw new Error('Member not found')

      const data = base64.replace(/^data:image\/\w+;base64,/, '')
      const filePath = join(photosDir(), `${id}.jpg`)
      writeFileSync(filePath, Buffer.from(data, 'base64'))

      getDb().prepare(`UPDATE members SET photo_path = ? WHERE id = ?`).run(filePath, id)
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
