// Verifies the OPEN-1..11 round at the APP level. The unit suite proves the
// handlers; this proves the renderer actually consumes the new contracts —
// which is exactly where both original P0s hid.
import { launchApp, completeSetup, logout, loginStaff, shot, OWNER } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'verify3' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// Escape deliberately does NOT log out while focus is in a text field, so use
// the header button whenever a search box has been typed into.
const logoutViaButton = async () => {
  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
}

const ownerLogin = async () => {
  await page.click('button:has-text("Owner / Admin Login")')
  const li = page.locator('.card input')
  await li.nth(0).fill(OWNER.name)
  await li.nth(1).fill(OWNER.password)
  await page.click('.card button:has-text("Sign in")')
  await page.waitForSelector('.sidebar', { timeout: 15000 })
}

try {
  await completeSetup(page)

  // Seed a shop + members entirely through the API surface the UI uses.
  const seeded = await page.evaluate(async () => {
    const prods = (await window.api.listProducts()).products || []
    const monthly = prods.find((p) => p.category === 'membership' && p.duration_days === 30)
    await window.api.updatePrice({ productId: monthly.id, newPrice: 2500 })

    // Active member, and a lapsed member (membership that ended long ago).
    const active = await window.api.createMember({ name: 'Active Anita', phone: '9841000001' })
    await window.api.addMembership({
      memberId: active.memberId,
      productId: monthly.id,
      startDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'cash'
    })
    const lapsed = await window.api.createMember({ name: 'Lapsed Bikash', phone: '9847654321' })
    await window.api.addMembership({
      memberId: lapsed.memberId,
      productId: monthly.id,
      startDate: '2024-01-01',
      paymentMethod: 'cash'
    })
    const stranger = await window.api.createMember({ name: 'Lapsed Chandra', phone: '9800000000' })
    return {
      monthlyId: monthly.id,
      active: active.memberId,
      lapsed: lapsed.memberId,
      stranger: stranger.memberId
    }
  })
  check('seeded members and priced membership', !!seeded.monthlyId)

  // --- OPEN-1: membership end date is exactly duration_days (inclusive) ---
  const dates = await page.evaluate(async (memberId) => {
    const r = await window.api.getMember({ memberId })
    return r
  }, seeded.active)
  // members:get returns activeMembership alongside member, not nested in it.
  const endDate = dates?.activeMembership?.endDate
  const startDate = dates?.activeMembership?.startDate
  if (startDate && endDate) {
    const usable = (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1
    check('OPEN-1 30-day membership grants exactly 30 days', usable === 30, `usable=${usable}`)
  } else {
    check('OPEN-1 membership dates readable', false, JSON.stringify(dates)?.slice(0, 120))
  }

  // --- OPEN-9 + OPEN-3 in the staff Members screen ---
  await logout(page)
  await loginStaff(page)
  await page.click('.tab:has-text("Members")')
  await page.waitForTimeout(600)
  await page.fill('input', 'Lapsed')
  await page.waitForTimeout(1200)
  const lapsedText = await page.locator('.content').innerText()
  await shot(page, 'verify3', '01-lapsed-vs-stranger')

  check(
    'OPEN-9 lapsed member shows what they were on',
    /Monthly/i.test(lapsedText),
    lapsedText.replace(/\n/g, ' ').slice(0, 100)
  )
  check('OPEN-9 never-joined member reads differently', /No membership on record/i.test(lapsedText))

  // Check in the active member, leave the tab, come back — button must stay
  // disabled (was: state lost on remount, allowing a duplicate).
  await page.fill('input', 'Active')
  await page.waitForTimeout(1200)
  await page.click('button:has-text("Check in")')
  await page.waitForTimeout(800)
  await page.click('.tab:has-text("Home")')
  await page.waitForTimeout(500)
  await page.click('.tab:has-text("Members")')
  await page.waitForTimeout(500)
  await page.fill('input', 'Active')
  await page.waitForTimeout(1200)
  await shot(page, 'verify3', '02-checkin-persists')

  const stillCheckedIn = await page.locator('button:has-text("Checked in")').count()
  const offersAgain = await page.locator('button:has-text("Check in")').count()
  check(
    'OPEN-3 check-in state survives a tab round-trip',
    stillCheckedIn === 1 && offersAgain === 0,
    `checkedIn=${stillCheckedIn} offers=${offersAgain}`
  )

  const footfall = await page.evaluate(async () => (await window.api.getTodayCheckins()).count)
  check('OPEN-3 footfall counted the visit once', footfall === 1, `count=${footfall}`)

  // --- OPEN-5: refund dialog defaults to what is still refundable ---
  await logoutViaButton()
  await ownerLogin()
  const partial = await page.evaluate(async () => {
    const tx = (await window.api.listTransactions({})).transactions
    const sale = tx.find((t) => t.type === 'membership')
    await window.api.refundTransaction({ transactionId: sale.id, amount: 500, reason: 'goodwill' })
    const after = (await window.api.listTransactions({})).transactions.find((t) => t.id === sale.id)
    return { amount: after.amount, refundedSoFar: after.refundedSoFar, remaining: after.remaining }
  })
  check(
    'OPEN-5 list rows carry refundedSoFar/remaining',
    partial.refundedSoFar === 500 && partial.remaining === partial.amount - 500,
    JSON.stringify(partial)
  )

  // --- OPEN-4: voided rows reachable on request, hidden by default ---
  const voided = await page.evaluate(async () => {
    // Void a FRESH sale: the membership above has a partial refund, and voiding
    // a refunded sale is correctly refused (double-reversal guard).
    const prods = (await window.api.listProducts()).products || []
    const dayPass = prods.find((p) => p.category === 'day_pass')
    await window.api.updatePrice({ productId: dayPass.id, newPrice: 300 })
    await window.api.createTransaction({
      type: 'day_pass',
      productId: dayPass.id,
      customerName: 'ToVoid',
      paymentMethod: 'cash'
    })
    const tx = (await window.api.listTransactions({})).transactions
    const target = tx.find((t) => t.customer === 'ToVoid')
    await window.api.voidTransaction({ transactionId: target.id, reason: 'qa' })
    const hidden = (await window.api.listTransactions({})).transactions.some(
      (t) => t.id === target.id
    )
    const shown = (await window.api.listTransactions({ includeVoided: true })).transactions.find(
      (t) => t.id === target.id
    )
    return { hidden, shownFlag: shown?.isVoided }
  })
  check(
    'OPEN-4 voided hidden by default, visible on request',
    voided.hidden === false && voided.shownFlag === true,
    JSON.stringify(voided)
  )

  // --- OPEN-7: a partial menu update does not wipe sibling columns ---
  const menu = await page.evaluate(async () => {
    const inv = (await window.api.listRestaurantInventory()).items || []
    const add = await window.api.addMenuItem({
      name: 'Masala Tea',
      category: 'bev',
      price: 60,
      inventoryItemId: inv[0].id
    })
    await window.api.updateMenuItem({ id: add.id, price: 75 })
    const after = (await window.api.listMenuItems()).items.find((m) => m.id === add.id)
    return {
      name: after?.name,
      price: after?.price,
      link: after?.inventory_item_id,
      cat: after?.category
    }
  })
  check(
    'OPEN-7 price-only update preserves name/category/link',
    menu.price === 75 && menu.name === 'Masala Tea' && !!menu.link && menu.cat === 'bev',
    JSON.stringify(menu)
  )

  // --- OPEN-10: duplicate inventory item rejected through the real API ---
  const dup = await page.evaluate(async () => {
    const items = (await window.api.listPoolInventory()).items || []
    const first = items[0]
    const r = await window.api.addPoolItem({
      name: first.item,
      category: 'gear',
      variant: first.variant === '—' ? null : first.variant
    })
    return { ok: r?.success, err: r?.error }
  })
  check('OPEN-10 duplicate pool item rejected', dup.ok === false, dup.err)

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} finally {
  await app.close()
  cleanup()
}
