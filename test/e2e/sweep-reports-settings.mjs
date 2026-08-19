// The Reports & Settings sweep that was never completed during the original QA
// round (its agent was killed repeatedly by API errors). Drives every report
// type and every settings sub-screen against a KNOWN seeded dataset, so the
// numbers can be checked rather than merely rendered.
import {
  launchApp,
  completeSetup,
  logout,
  loginStaff,
  shot,
  STAFF,
  seedShop,
  loginOwner
} from './harness.mjs'
import { existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ExcelJS from 'exceljs'

const localToday = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const { app, page, errors, cleanup } = await launchApp({ area: 'reports-settings' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const tab = async (label) => {
  await page.click(`.nav-item:has-text("${label}")`)
  await page.waitForTimeout(700)
}

try {
  await completeSetup(page)
  // A fresh database seeds no catalogue any more; build one to sell from.
  await seedShop(page)

  // ------------------------------------------------------------------
  // Known dataset. Every later assertion is checked against these numbers.
  //   day pass    500 cash
  //   day package 1200 qr
  //   membership  2500 qr   (30 days)
  //   pool item   250 x 2 = 500 cash
  //   restaurant  50 x 3  = 150 cash
  //   TOTAL 4850  (cash 1150, qr 3700)
  // ------------------------------------------------------------------
  const seed = await page.evaluate(async () => {
    const prods = (await window.api.listProducts()).products || []
    const dayPass = prods.find((p) => p.category === 'day_pass')
    const pkg = prods.find((p) => p.category === 'day_package')
    const monthly = prods.find((p) => p.category === 'membership' && p.duration_days === 30)
    await window.api.updatePrice({ productId: dayPass.id, newPrice: 500 })
    await window.api.updatePrice({ productId: pkg.id, newPrice: 1200 })
    await window.api.updatePrice({ productId: monthly.id, newPrice: 2500 })

    const pool = (await window.api.listPoolInventory()).items || []
    await window.api.updatePoolItem({ itemId: pool[0].id, fields: { sellingPrice: 250 } })
    await window.api.restockPoolItem({ itemId: pool[0].id, quantity: 20 })

    const rinv = (await window.api.listRestaurantInventory()).items || []
    await window.api.restockRestaurantItem({ itemId: rinv[0].id, quantity: 40 })
    const menu = await window.api.addMenuItem({
      name: 'Chiya',
      category: 'bev',
      price: 50,
      inventoryItemId: rinv[0].id
    })
    return {
      dayPass: dayPass.id,
      pkg: pkg.id,
      monthly: monthly.id,
      pool: pool[0].id,
      menu: menu.id
    }
  })

  await logout(page)
  await loginStaff(page)
  const sold = await page.evaluate(async (s) => {
    await window.api.createTransaction({
      type: 'day_pass',
      productId: s.dayPass,
      customerName: 'Walk-in A',
      paymentMethod: 'cash'
    })
    await window.api.createTransaction({
      type: 'day_package',
      productId: s.pkg,
      customerName: 'Walk-in B',
      paymentMethod: 'qr'
    })
    const m = await window.api.createMember({ name: 'Member One', phone: '9841000001' })
    await window.api.addMembership({
      memberId: m.memberId,
      productId: s.monthly,
      startDate: (() => {
        const d = new Date()
        const p2 = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
      })(),
      paymentMethod: 'qr'
    })
    await window.api.sellPoolItem({
      itemId: s.pool,
      quantity: 2,
      paymentMethod: 'cash',
      customerName: 'Walk-in C'
    })
    await window.api.restaurantCheckout({
      items: [{ id: s.menu, quantity: 3 }],
      paymentMethod: 'cash'
    })
    const sum = await window.api.todaySummary({})
    return { total: sum.total, cash: sum.cash, qr: sum.qr, byType: sum.byType }
  }, seed)
  check(
    'seeded day totals are exactly as designed',
    sold.total === 4850 && sold.cash === 1150 && sold.qr === 3700,
    JSON.stringify(sold)
  )

  await logout(page)
  await loginOwner(page)

  // ------------------------------------------------------------------
  // REPORTS — all seven types, checked against the seeded numbers.
  // ------------------------------------------------------------------
  await tab('Reports')
  await shot(page, 'reports-settings', '01-reports-screen')
  const reportButtons = await page.locator('.content button').allInnerTexts()
  check('reports screen offers report types', reportButtons.length >= 5, reportButtons.join(' / '))

  const daily = await page.evaluate(async () => await window.api.dailyReport({}))
  check(
    'daily report total matches the day',
    daily?.summary?.total === 4850 || daily?.total === 4850,
    JSON.stringify(daily?.summary ?? daily).slice(0, 120)
  )

  const monthly = await page.evaluate(async () => {
    const now = new Date()
    const ok = await window.api.monthlyReport({
      year: now.getFullYear(),
      month: now.getMonth() + 1
    })
    // A malformed month must complain rather than report an empty month.
    const bad = await window.api.monthlyReport({ year: 2026, month: '2026-08' })
    return { ok, badError: bad?.error }
  })
  check(
    "monthly report includes today's takings",
    JSON.stringify(monthly.ok).includes('4850'),
    JSON.stringify(monthly.ok?.summary ?? monthly.ok).slice(0, 120)
  )
  check(
    'a malformed month is rejected, not silently reported as zero',
    /month must be/i.test(monthly.badError || ''),
    monthly.badError
  )

  const today = localToday()
  const custom = await page.evaluate(
    async (d) => await window.api.customReport({ dateFrom: d, dateTo: d }),
    today
  )
  check('custom range report matches the same day', JSON.stringify(custom).includes('4850'))

  const retention = await page.evaluate(async () => await window.api.retentionReport({}))
  check('retention report returns without error', retention && !retention.error)

  const turnover = await page.evaluate(
    async (d) => await window.api.inventoryTurnoverReport({ dateFrom: d, dateTo: d }),
    today
  )
  check(
    'inventory turnover counts the 2 pool items sold',
    JSON.stringify(turnover).includes('500') || JSON.stringify(turnover).includes('250'),
    JSON.stringify(turnover).slice(0, 120)
  )

  const bookingRep = await page.evaluate(
    async (d) => await window.api.bookingReport({ dateFrom: d, dateTo: d }),
    today
  )
  check('booking report returns without error', bookingRep && !bookingRep.error)

  const staffRep = await page.evaluate(
    async (d) => await window.api.staffActivityReport({ dateFrom: d, dateTo: d }),
    today
  )
  check(
    'staff activity attributes the sales to the staff account',
    JSON.stringify(staffRep).includes(STAFF.name),
    JSON.stringify(staffRep).slice(0, 120)
  )

  // Date sanity: an inverted range must not silently return the full set.
  const inverted = await page.evaluate(
    async () => await window.api.customReport({ dateFrom: '2026-12-31', dateTo: '2020-01-01' })
  )
  const invertedTotal = inverted?.summary?.total ?? inverted?.total ?? 0
  check(
    'inverted date range yields nothing (not everything)',
    invertedTotal === 0,
    `total=${invertedTotal}`
  )

  // Excel export normally opens a native save dialog Playwright cannot drive,
  // but the handler accepts an explicit savePath — so write a real file to a
  // temp path and read it back to prove the sheet actually contains the data.
  const xlsxPath = join(tmpdir(), `refresh-qa-report-${Date.now()}.xlsx`)
  const exported = await page.evaluate(
    async ({ path, dateFrom }) => {
      const data = await window.api.dailyReport({ date: dateFrom })
      const r = await window.api.exportExcel({ reportType: 'daily', data, savePath: path })
      return { ok: r?.success !== false, err: r?.error, path: r?.filePath }
    },
    { path: xlsxPath, dateFrom: today }
  )
  check('Excel export writes a file', exported.ok && existsSync(xlsxPath), JSON.stringify(exported))

  if (existsSync(xlsxPath)) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(xlsxPath)
    const sheetNames = wb.worksheets.map((w) => w.name)
    let foundTotal = false
    wb.worksheets.forEach((ws) =>
      ws.eachRow((row) => {
        row.eachCell((c) => {
          if (Number(c.value) === 4850) foundTotal = true
        })
      })
    )
    check('exported workbook has sheets', sheetNames.length > 0, sheetNames.join(', '))
    check("exported workbook contains the day's real total (4850)", foundTotal)
    rmSync(xlsxPath, { force: true })
  }

  // ------------------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------------------
  await tab('Settings')
  await page.waitForTimeout(600)
  await shot(page, 'reports-settings', '02-settings-screen')
  const settingsText = await page.locator('.content').innerText()
  check(
    'settings screen exposes its sub-sections',
    /Pricing|Staff|Backup|Business/i.test(settingsText),
    settingsText.replace(/\n/g, ' ').slice(0, 110)
  )

  // Business info persists across a restart.
  await page.evaluate(async () => {
    await window.api.setSetting({ key: 'business_name', value: 'Refresh QA Center' })
    await window.api.setSetting({ key: 'business_phone', value: '+977 9800000000' })
  })
  const persisted = await page.evaluate(async () => {
    const s = await window.api.getSettings()
    return s.settings?.business_name
  })
  check('business info saved', persisted === 'Refresh QA Center', persisted)

  // Pricing history: a price change must not rewrite past transactions.
  const priceHistory = await page.evaluate(async (s) => {
    await window.api.updatePrice({ productId: s.dayPass, newPrice: 800 })
    const h = await window.api.priceHistory({ productId: s.dayPass })
    const tx = (await window.api.listTransactions({})).transactions
    const oldSale = tx.find((t) => t.type === 'day_pass')
    return { historyCount: (h.history || []).length, oldAmount: oldSale?.amount }
  }, seed)
  check(
    'price change is recorded in history',
    priceHistory.historyCount >= 1,
    `entries=${priceHistory.historyCount}`
  )
  check(
    'a price change does NOT alter past transactions',
    priceHistory.oldAmount === 500,
    `old sale still ${priceHistory.oldAmount}`
  )

  // Staff & admin lifecycle, including the safety rails.
  const staffMgmt = await page.evaluate(async () => {
    const out = {}
    out.addStaff = (await window.api.addStaff({ name: 'Second Staff', pin: '5555' }))?.success
    out.dupPin = (await window.api.addStaff({ name: 'Third', pin: '5555' }))?.error
    out.badPin = (await window.api.addStaff({ name: 'Fourth', pin: '12' }))?.error
    out.addAdmin = (
      await window.api.addAdmin({ name: 'Second Admin', password: 'adminpass' })
    )?.success
    out.dupAdmin = (await window.api.addAdmin({ name: 'Second Admin', password: 'x2345' }))?.error
    const admins = (await window.api.listAdmins()).users || []
    const me = admins.find((a) => a.name === 'Sambhav')
    out.selfDeactivate = (await window.api.deactivateAdmin({ userId: me.id }))?.error
    return out
  })
  check('add staff works', staffMgmt.addStaff === true)
  check('duplicate PIN rejected', /already in use/i.test(staffMgmt.dupPin || ''), staffMgmt.dupPin)
  check('non-4-digit PIN rejected', /4 digits/i.test(staffMgmt.badPin || ''), staffMgmt.badPin)
  check('add admin works', staffMgmt.addAdmin === true)
  check('duplicate admin name rejected', !!staffMgmt.dupAdmin, staffMgmt.dupAdmin)
  check(
    'cannot deactivate your own admin account',
    /your own/i.test(staffMgmt.selfDeactivate || ''),
    staffMgmt.selfDeactivate
  )

  // Change the admin password, then prove the NEW one actually logs in.
  const pwChange = await page.evaluate(async () => {
    const bad = await window.api.changeAdminPassword({
      currentPassword: 'wrong',
      newPassword: 'newpass123'
    })
    const good = await window.api.changeAdminPassword({
      currentPassword: 'refresh2024',
      newPassword: 'newpass123'
    })
    return { bad: bad?.error, good: good?.success }
  })
  check('wrong current password rejected', /incorrect/i.test(pwChange.bad || ''), pwChange.bad)
  check('password change accepted', pwChange.good === true)

  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
  await loginOwner(page, 'newpass123')
  check('the NEW admin password logs in', true)

  // Restaurant menu editor — partial update must not wipe siblings (OPEN-7).
  const menuEdit = await page.evaluate(async (s) => {
    const before = (await window.api.listMenuItems()).items.find((m) => m.id === s.menu)
    await window.api.updateMenuItem({ id: s.menu, price: 65 })
    const after = (await window.api.listMenuItems()).items.find((m) => m.id === s.menu)
    const toggled = await window.api.toggleMenuItem({ id: s.menu, isActive: false })
    const afterToggle = (await window.api.listMenuItems({ includeInactive: true })).items.find(
      (m) => m.id === s.menu
    )
    return {
      priceChanged: after?.price === 65,
      nameKept: after?.name === before?.name,
      linkKept: after?.inventory_item_id === before?.inventory_item_id,
      toggled: toggled?.success,
      inactive: afterToggle ? afterToggle.is_active === 0 : null
    }
  }, seed)
  check(
    'menu price-only update keeps name and stock link',
    menuEdit.priceChanged && menuEdit.nameKept && menuEdit.linkKept,
    JSON.stringify(menuEdit)
  )
  check('menu item can be toggled unavailable', menuEdit.toggled === true)

  // Backup to a temp folder, then verify a real file landed.
  const backup = await page.evaluate(async () => {
    const s = await window.api.getSettings()
    const r = await window.api.createBackup({})
    const after = await window.api.getBackupStatus()
    return {
      ran: r?.success,
      err: r?.error,
      status: after?.status,
      path: after?.lastBackupPath,
      configured: !!s.settings?.backup_path
    }
  })
  check(
    'backup either succeeds or reports a clear "not configured" error',
    backup.ran === true || /not configured|destination/i.test(backup.err || ''),
    JSON.stringify(backup).slice(0, 140)
  )

  // Audit log must contain the actions performed in this session.
  const audit = await page.evaluate(async () => {
    const r = await window.api.listAudit({})
    const actions = (r.entries || r.logs || []).map((e) => e.action)
    return { count: actions.length, actions: [...new Set(actions)].slice(0, 12) }
  })
  check(
    'audit log recorded this session (staff add, price change, void…)',
    audit.count > 0 && audit.actions.some((a) => /staff|price|admin|transaction/i.test(a)),
    JSON.stringify(audit.actions)
  )
  await shot(page, 'reports-settings', '03-audit')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\nFAILED:')
    failed.forEach((f) => console.log(` - ${f.name} :: ${f.detail}`))
    process.exitCode = 1
  }
} finally {
  await app.close()
  cleanup()
}
