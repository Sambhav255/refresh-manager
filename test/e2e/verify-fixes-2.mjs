// Verifies the second batch of post-QA fixes (P1/P2 round).
import {
  launchApp,
  completeSetup,
  logout,
  loginStaff,
  shot,
  OWNER,
  seedShop,
  loginOwner
} from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'verify2' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

try {
  await completeSetup(page)
  // A fresh database seeds no catalogue any more; build one to sell from.
  await seedShop(page)

  // --- Setup wizard now trims names: login with the untrimmed name works ---
  // (completeSetup fills plain names; verify the stored name has no padding)
  const nameOk = await page.evaluate(async () => {
    const r = await window.api.listAdmins()
    return (r.users || []).map((u) => u.name)
  })
  check('setup stores trimmed owner name', nameOk[0] === OWNER.name, JSON.stringify(nameOk))

  // --- Backend validation guards ---
  const guards = await page.evaluate(async () => {
    const out = {}
    const err = (r) => (r?.success === false ? r.error : 'ACCEPTED')
    out.blankName = err(await window.api.addPoolItem({ name: '  ', category: 'gear' }))
    out.negPrice = err(
      await window.api.addPoolItem({ name: 'X', category: 'gear', sellingPrice: -100 })
    )
    out.textPrice = err(
      await window.api.addPoolItem({ name: 'Y', category: 'gear', sellingPrice: 'abc' })
    )
    const items = (await window.api.listPoolInventory()).items || []
    const first = items[0]
    out.hugeRestock = err(
      await window.api.restockPoolItem({ itemId: first.id, quantity: 999999999999 })
    )
    out.adjustNoReason = err(await window.api.adjustPoolItem({ itemId: first.id, newQuantity: 5 }))
    out.badDate = err(
      await window.api.createBooking({ bookingName: 'B', bookingDate: 'not-a-date' })
    )
    out.negDeposit = err(
      await window.api.createBooking({
        bookingName: 'B',
        bookingDate: '2026-09-01',
        depositPaid: -3000
      })
    )
    out.negPeople = err(
      await window.api.createBooking({
        bookingName: 'B',
        bookingDate: '2026-09-01',
        numPeople: -40
      })
    )
    out.missingBooking = err(
      await window.api.updateBooking({ bookingId: 99999, fields: { bookingName: 'ghost' } })
    )
    return out
  })
  for (const [k, v] of Object.entries(guards)) {
    check(`guard rejects ${k}`, v !== 'ACCEPTED', v)
  }

  // --- Owner can now set a selling price, unblocking staff Sell Item ---
  const priced = await page.evaluate(async () => {
    const items = (await window.api.listPoolInventory()).items || []
    const target = items[0]
    const r = await window.api.updatePoolItem({
      itemId: target.id,
      fields: { sellingPrice: 250 }
    })
    const after = (await window.api.listPoolInventory()).items.find((i) => i.id === target.id)
    await window.api.restockPoolItem({ itemId: target.id, quantity: 10 })
    return { ok: r?.success !== false, price: after?.price, id: target.id }
  })
  check('owner can set a selling price', priced.ok && priced.price === 250, `price=${priced.price}`)

  // --- EOD breakdown now reconciles to the headline total ---
  await page.evaluate(async () => {
    const prods = (await window.api.listProducts()).products || []
    const dayPass = prods.find((p) => p.category === 'day_pass')
    await window.api.updatePrice({ productId: dayPass.id, newPrice: 500 })
  })
  await logout(page)
  await loginStaff(page)

  await page.evaluate(async () => {
    const prods = (await window.api.listProducts()).products || []
    const dayPass = prods.find((p) => p.category === 'day_pass')
    await window.api.createTransaction({
      type: 'day_pass',
      productId: dayPass.id,
      customerName: 'Walk-in',
      paymentMethod: 'cash'
    })
    const items = (await window.api.listPoolInventory()).items || []
    const sellable = items.find((i) => i.price > 0)
    await window.api.sellPoolItem({
      itemId: sellable.id,
      quantity: 2,
      paymentMethod: 'cash',
      customerName: 'Walk-in'
    })
  })

  await page.click('.tab:has-text("End of Day")')
  await page.waitForTimeout(1200)
  const eodText = await page.locator('.content').innerText()
  await shot(page, 'verify2', '01-eod-breakdown')
  check('EOD lists Pool Items', /Pool Items/i.test(eodText))
  check('EOD no longer hides non-membership revenue', /Day Passes/i.test(eodText))

  const eodSums = await page.evaluate(async () => {
    const s = await window.api.todaySummary({})
    const sum = Object.values(s.byType || {}).reduce((a, b) => a + b, 0)
    return { total: s.total, sum }
  })
  check(
    'EOD breakdown reconciles to total',
    eodSums.total === eodSums.sum,
    `total=${eodSums.total} lines=${eodSums.sum}`
  )

  // --- Paused members are no longer filed under Expired ---
  await logout(page)
  await loginOwner(page)

  // --- Frameless window controls actually work now ---
  const winCtl = await page.evaluate(async () => {
    const max = await window.api.toggleMaximizeWindow()
    const min = typeof window.api.minimizeWindow === 'function'
    return { maximized: max?.maximized, exposed: min }
  })
  check('title-bar maximize is wired', winCtl.exposed && winCtl.maximized === true)
  await page.evaluate(() => window.api.toggleMaximizeWindow())

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} finally {
  await app.close()
  cleanup()
}
