import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { requireOwner } from '../session.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

// 2-E: read-only view of the audit trail for the owner.
export function registerAuditHandlers() {
  ipcMain.handle(
    'audit:list',
    wrap(({ limit = 200, action } = {}) => {
      requireOwner()
      let sql = `
        SELECT a.id, a.action, a.detail, a.created_at, u.name as actor_name
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE 1=1
      `
      const params = []
      if (action) {
        sql += ` AND a.action = ?`
        params.push(action)
      }
      sql += ` ORDER BY a.id DESC LIMIT ?`
      params.push(Math.min(Number(limit) || 200, 1000))
      const entries = getDb()
        .prepare(sql)
        .all(...params)
      return { entries }
    })
  )
}
