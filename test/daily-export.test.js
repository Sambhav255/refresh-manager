import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ExcelJS from 'exceljs'
import { writeDailyExport, dailyExportFilename } from '../src/main/daily-export.js'
import { freshDb, seed } from './helpers.js'

let db

beforeEach(() => {
  db = freshDb()
  seed(db)
})

describe('writeDailyExport', () => {
  it('writes an xlsx with the expected sheets', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'refresh-daily-'))
    const dateStr = '2026-09-03'
    const filePath = await writeDailyExport(db, folder, dateStr)

    expect(filePath).toBe(join(folder, dailyExportFilename(dateStr)))
    expect(existsSync(filePath)).toBe(true)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    expect(wb.worksheets.map((w) => w.name)).toEqual(
      expect.arrayContaining([
        'Sales',
        'Lines',
        'Payments',
        'Members',
        'Pool Inventory',
        'Restaurant Inventory',
        'Bookings',
        'Summary'
      ])
    )
    expect(wb.worksheets).toHaveLength(8)
  })
})
