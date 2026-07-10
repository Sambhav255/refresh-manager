import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ExcelJS from 'exceljs'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner } from './helpers.js'

let ids

beforeEach(() => {
  const db = freshDb()
  ids = seed(db)
  loginOwner(ids)
})

async function sheetsFor(reportType, data) {
  const savePath = join(mkdtempSync(join(tmpdir(), 'refresh-xlsx-')), 'r.xlsx')
  const res = await __invoke('reports:export-excel', { reportType, data, savePath })
  expect(res.success).toBe(true)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(savePath)
  return wb.worksheets.map((w) => w.name)
}

describe('5-A / P1-2 — each report type exports its full sheet set (not summary-only)', () => {
  it('retention', async () => {
    const names = await sheetsFor('retention', {
      due: 5,
      renewed: 3,
      retentionRate: 60,
      churned: [{ name: 'A', phone: '9', product_name: 'M', end_date: '2026-01-01' }]
    })
    expect(names).toContain('Retention')
    expect(names).toContain('Churned Members')
  })

  it('inventory-turnover', async () => {
    const names = await sheetsFor('inventory-turnover', {
      pool: [{ name: 'Goggles', variant: 'M', sold: 2, revenue: 400 }],
      restaurant: [{ name: 'Tea', sold: 5, revenue: 750 }],
      lowStock: [{ name: 'Tea leaves', source: 'restaurant', current_stock: 1, reorder_level: 3 }]
    })
    expect(names).toEqual(expect.arrayContaining(['Pool Items', 'Restaurant Items', 'Low Stock']))
  })

  it('bookings', async () => {
    const names = await sheetsFor('bookings', {
      bookings: [{ booking_name: 'Party', booking_date: '2026-03-01', status: 'confirmed' }],
      summary: { count: 1, byStatus: { confirmed: 1 }, depositTotal: 500, expectedTotal: 2000 }
    })
    expect(names).toEqual(expect.arrayContaining(['Bookings Summary', 'Bookings']))
  })

  it('staff-activity', async () => {
    const names = await sheetsFor('staff-activity', {
      staff: [{ name: 'Staff', txn_count: 4, total: 1200 }],
      transactions: [{ id: 1, time: '10:00', customer: 'C', type: 'day_pass', amount: 300, pay: 'Cash', staff: 'Staff' }]
    })
    expect(names).toContain('Staff Totals')
    expect(names).toContain('Transactions')
  })
})
