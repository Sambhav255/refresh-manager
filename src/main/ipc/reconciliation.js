import { ipcMain } from 'electron'
import { getDb } from '../db/index.js'
import { getSession, requireOwner, requireStaffOrOwner } from '../session.js'
import { todayLocal } from './utils.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

export function registerReconciliationHandlers() {
  ipcMain.handle(
    'reconciliation:create',
    wrap(({ systemCash, physicalCash, reason, reconcileDate }) => {
      const session = requireStaffOrOwner()
      const date = reconcileDate || todayLocal()
      const system = Number(systemCash) || 0
      const physical = Number(physicalCash) || 0
      const discrepancy = physical - system

      const result = getDb()
        .prepare(
          `INSERT INTO cash_reconciliations (reconcile_date, system_cash, physical_cash, discrepancy, reason, staff_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(date, system, physical, discrepancy, reason || null, session.userId)

      return { success: true, id: result.lastInsertRowid, discrepancy }
    })
  )

  ipcMain.handle(
    'reconciliation:get-today',
    wrap(() => {
      requireStaffOrOwner()
      const today = todayLocal()
      const row = getDb()
        .prepare(
          `SELECT cr.*, u.name as staff_name
           FROM cash_reconciliations cr
           JOIN users u ON u.id = cr.staff_id
           WHERE cr.reconcile_date = ?
           ORDER BY cr.created_at DESC LIMIT 1`
        )
        .get(today)
      return { reconciliation: row || null }
    })
  )

  ipcMain.handle(
    'reconciliation:list',
    wrap(({ dateFrom, dateTo } = {}) => {
      requireOwner()
      let sql = `
        SELECT cr.*, u.name as staff_name
        FROM cash_reconciliations cr
        JOIN users u ON u.id = cr.staff_id
        WHERE 1=1
      `
      const params = []
      if (dateFrom) {
        sql += ` AND cr.reconcile_date >= ?`
        params.push(dateFrom)
      }
      if (dateTo) {
        sql += ` AND cr.reconcile_date <= ?`
        params.push(dateTo)
      }
      sql += ` ORDER BY cr.reconcile_date DESC, cr.created_at DESC`
      const reconciliations = getDb()
        .prepare(sql)
        .all(...params)
      return { reconciliations }
    })
  )
}
