// Verifies the final UI round: booking deposits + cancel flow, transactions
// filters/paging/voided toggle, POS clear-order, inventory adjust & price
// controls, and the dashboard alert navigation.
import { launchApp, completeSetup, logout, loginStaff, shot, seedShop } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'verify4' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
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

  // ---------- Bookings: deposit fields exist and reach the database ----------
  await tab('Bookings')
  await page.click('button:has-text("New booking")')
  await page.waitForTimeout(400)
  const formText = await page.locator('.card').first().innerText()
  check(
    'deposit + total fields are on the booking form',
    /Deposit paid/i.test(formText) && /Total expected/i.test(formText),
    formText.replace(/\n/g, ' ').slice(0, 90)
  )

  await page.fill('.field:has(label:text-is("Name")) input', 'Birthday Party')
  await page.fill('.field:has(label:has-text("Total expected")) input', '20000')
  await page.fill('.field:has(label:has-text("Deposit paid")) input', '3000')
  await shot(page, 'verify4', '01-booking-form-deposit')
  await page.click('button:has-text("Save")')
  await page.waitForTimeout(1200)

  const saved = await page.evaluate(async () => {
    const r = await window.api.listBookings({})
    const b = (r.bookings || [])[0]
    return { name: b?.bookingName, deposit: b?.depositPaid, total: b?.totalExpected }
  })
  check(
    'deposit saved through the UI (was always 0)',
    saved.deposit === 3000 && saved.total === 20000,
    JSON.stringify(saved)
  )

  const depositTx = await page.evaluate(async () => {
    const r = await window.api.listTransactions({})
    return (r.transactions || []).filter((t) => t.type === 'booking_deposit').length
  })
  check('deposit recorded a booking_deposit transaction', depositTx === 1, `rows=${depositTx}`)

  const cardText = await page.locator('.content').innerText()
  check(
    'booking card shows the deposit and balance',
    /Deposit/i.test(cardText) && /balance/i.test(cardText)
  )

  // ---------- Cancel asks first and reports the outstanding deposit ----------
  await page.click('button:has-text("Cancel")')
  await page.waitForTimeout(500)
  const confirmText = await page.locator('.content').innerText()
  check(
    'cancel asks for confirmation and names the deposit',
    /Cancel .?Birthday Party/i.test(confirmText) && /3,?000/.test(confirmText),
    confirmText.replace(/\n/g, ' ').slice(0, 110)
  )
  await shot(page, 'verify4', '02-cancel-confirm')
  await page.click('button:has-text("Keep it")')
  await page.waitForTimeout(400)
  const kept = await page.evaluate(
    async () => (await window.api.listBookings({})).bookings[0]?.status
  )
  check('"Keep it" leaves the booking alone', kept !== 'cancelled', `status=${kept}`)

  // ---------- Transactions: type coverage, voided toggle, empty state ----------
  await tab('Transactions')
  const typeOptions = await page.locator('select').nth(1).locator('option').allInnerTexts()
  check(
    'type filter covers all 7 transaction types',
    typeOptions.length === 8 &&
      typeOptions.includes('Booking Deposits') &&
      typeOptions.includes('Refunds'),
    `${typeOptions.length} options`
  )
  const hasVoidToggle = await page.locator('text=Show voided').count()
  check('voided toggle present', hasVoidToggle === 1)
  const hasCustom =
    typeOptions.length > 0 &&
    (await page.locator('select').first().locator('option').allInnerTexts())
  check('custom date range offered', hasCustom.includes('Custom range…'), hasCustom.join('/'))

  // A booking deposit may NOT be voided directly — it belongs to its booking,
  // which would carry on claiming the money had been paid. Sell something
  // voidable instead, then confirm the toggle reveals it struck through.
  const depositGuard = await page.evaluate(async () => {
    const tx = (await window.api.listTransactions({})).transactions
    const deposit = tx.find((t) => t.type === 'booking_deposit')
    const refused = await window.api.voidTransaction({
      transactionId: deposit.id,
      reason: 'qa check'
    })

    const prods = (await window.api.listProducts()).products || []
    const dayPass = prods.find((p) => p.category === 'day_pass')
    await window.api.updatePrice({ productId: dayPass.id, newPrice: 300 })
    await window.api.createTransaction({
      type: 'day_pass',
      productId: dayPass.id,
      customerName: 'ToVoid',
      paymentMethod: 'cash'
    })
    const sale = (await window.api.listTransactions({})).transactions.find(
      (t) => t.customer === 'ToVoid'
    )
    await window.api.voidTransaction({ transactionId: sale.id, reason: 'qa check' })
    return { refused: refused?.success === false, error: refused?.error }
  })
  check(
    'a booking deposit cannot be voided out from under its booking',
    depositGuard.refused,
    depositGuard.error
  )
  await tab('Dashboard')
  await tab('Transactions')
  // Count real data rows only — the empty-state placeholder is also a <tr>.
  const dataRows = () => page.locator('tbody tr:not(:has-text("No transactions match"))').count()
  const beforeToggle = await dataRows()
  await page.click('text=Show voided')
  await page.waitForTimeout(900)
  const afterToggle = await dataRows()
  const voidedLabel = await page.locator('td:has-text("voided")').count()
  check(
    'Show voided reveals the voided row',
    afterToggle === beforeToggle + 1 && voidedLabel === 1,
    `before=${beforeToggle} after=${afterToggle} label=${voidedLabel}`
  )
  await shot(page, 'verify4', '03-voided-visible')

  // ---------- Inventory: price + adjust controls ----------
  await tab('Inventory')
  const invText = await page.locator('.content').innerText()
  check('reorder banner wording fixed', !/below reorder threshold/i.test(invText))
  // Four per-row buttons were replaced by one panel opened by clicking the row.
  await page.locator('tbody tr').first().click()
  await page.waitForTimeout(500)
  check(
    'the item panel offers Price, Adjust, Restock, History and Retire',
    (await page.locator('.seg button:has-text("Adjust stock")').count()) > 0 &&
      (await page.locator('.seg button:has-text("Price")').count()) > 0 &&
      (await page.locator('.seg button:has-text("History")').count()) > 0 &&
      (await page.locator('.seg button:has-text("Retire")').count()) > 0
  )

  await page.locator('.seg button:has-text("Adjust stock")').first().click()
  await page.waitForTimeout(400)
  await page.click('button:has-text("Save adjustment")')
  await page.waitForTimeout(500)
  const adjErr = await page.locator('.alert.red').first().innerText()
  check('adjust without a reason is refused visibly', /reason/i.test(adjErr), adjErr.slice(0, 60))

  await page.fill('.field:has(label:text-is("Counted stock")) input', '7')
  await page.fill('.field:has(label:text-is("Reason")) input', 'stock count')
  await page.click('button:has-text("Save adjustment")')
  await page.waitForTimeout(900)
  const adjusted = await page.evaluate(async () => {
    const items = (await window.api.listPoolInventory()).items || []
    return items[0]?.stock
  })
  check('adjustment applied through the UI', adjusted === 7, `stock=${adjusted}`)
  await shot(page, 'verify4', '04-inventory-adjusted')

  // ---------- Dashboard alerts navigate ----------
  // A properly stocked shop has no low-stock alert, so create the condition the
  // check is about rather than relying on seeded items sitting at zero.
  await page.evaluate(async () => {
    const items = (await window.api.listPoolInventory()).items || []
    await window.api.adjustPoolItem({
      itemId: items[0].id,
      newQuantity: 1,
      reason: 'drive below reorder level for the alert check'
    })
  })
  await tab('Dashboard')
  const lowStockAlert = page.locator('.alert:has-text("low stock")')
  if ((await lowStockAlert.count()) > 0) {
    await lowStockAlert.first().click()
    await page.waitForTimeout(700)
    const nowOn = await page.locator('.nav-item.active').innerText()
    check('low-stock alert navigates to Inventory', /Inventory/i.test(nowOn), nowOn)
  } else {
    check('low-stock alert present to click', false, 'no low-stock alert rendered')
  }

  // ---------- POS clear order ----------
  await page.evaluate(async () => {
    const inv = (await window.api.listRestaurantInventory()).items || []
    await window.api.restockRestaurantItem({ itemId: inv[0].id, quantity: 20 })
    await window.api.addMenuItem({ name: 'Chiya', category: 'bev', price: 50 })
  })
  await logout(page)
  await loginStaff(page)
  await page.click('text=Restaurant')
  await page.waitForTimeout(900)
  await page.click('text=Chiya')
  await page.waitForTimeout(400)
  const hasClear = await page.locator('button:has-text("Clear order")').count()
  check('POS has a Clear order button', hasClear === 1)
  await page.click('button:has-text("Clear order")')
  await page.waitForTimeout(400)
  const cartEmptied = await page.locator('button:has-text("Clear order")').count()
  check('Clear order empties the cart', cartEmptied === 0)
  await shot(page, 'verify4', '05-pos-cleared')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} finally {
  await app.close()
  cleanup()
}
