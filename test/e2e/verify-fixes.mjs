// Verifies the four bugs fixed after the QA sweep, by driving the real app.
import { launchApp, completeSetup, logout, loginStaff, ownerTab, shot } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'verify' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

try {
  await completeSetup(page)

  // --- FIX 1: dashboard renders instead of crashing to the error boundary ---
  const boundary = await page.locator('text=Something went wrong').count()
  const dashText = await page.locator('.body-wrap').innerText()
  check('P0-1 dashboard renders (no error boundary)', boundary === 0)
  check(
    'P0-1 dashboard shows real content',
    /Today|Revenue|Pool|Backup/i.test(dashText),
    dashText.slice(0, 60).replace(/\n/g, ' ')
  )
  await shot(page, 'verify', '01-dashboard-fixed')

  // Seed a shop: price a product, add a linked menu item, restock it.
  const seeded = await page.evaluate(async () => {
    const prods = await window.api.listProducts()
    const dayPass = (prods.products || []).find((p) => p.category === 'day_pass')
    await window.api.updatePrice({ productId: dayPass.id, price: 500 })
    const inv = await window.api.listRestaurantInventory()
    const teaStock = (inv.items || [])[0]
    await window.api.restockRestaurantItem({ itemId: teaStock.id, quantity: 20 })
    const menu = await window.api.addMenuItem({
      name: 'Tea',
      category: 'bev',
      price: 50,
      inventoryItemId: teaStock.id
    })
    return { dayPassId: dayPass.id, teaStockId: teaStock.id, menuId: menu.itemId, ok: true }
  })
  check('shop seeded for POS test', !!seeded.ok)

  // --- FIX 2: restaurant POS checkout actually completes ---
  await logout(page)
  await loginStaff(page)
  await page.click('text=Restaurant')
  await page.waitForTimeout(900)
  await page.click('text=Tea')
  await page.waitForTimeout(400)
  await shot(page, 'verify', '02-pos-cart')
  await page.click('button:has-text("Confirm order")')
  await page.waitForTimeout(1500)

  const posErr = await page.locator('.alert.red').count()
  const posBody = await page.locator('.app').innerText()
  check('P0-2 POS checkout shows no error', posErr === 0)
  check('P0-2 POS reached the saved state', /saved|order/i.test(posBody))
  await shot(page, 'verify', '03-pos-after-checkout')

  const after = await page.evaluate(async () => {
    const tx = await window.api.listTransactions({})
    const inv = await window.api.listRestaurantInventory()
    return {
      restaurantRows: (tx.transactions || []).filter((t) => t.type === 'restaurant').length,
      stock: (inv.items || [])[0]?.current_stock,
      products: (tx.transactions || []).map((t) => t.product)
    }
  })
  check(
    'P0-2 restaurant transaction written',
    after.restaurantRows === 1,
    `rows=${after.restaurantRows}`
  )
  check('P0-2 linked stock drawn down 20 -> 19', after.stock === 19, `stock=${after.stock}`)

  // --- FIX 3: product column is a real name, never "undefined" ---
  const bad = after.products.filter((p) => !p || String(p).includes('undefined'))
  check(
    'P1-3 no undefined product names',
    bad.length === 0,
    `products=${JSON.stringify(after.products)}`
  )

  // --- FIX 4: voiding a refund is refused ---
  await logout(page)
  await page.click('button:has-text("Owner / Admin Login")')
  const inputs = page.locator('.card input')
  await inputs.nth(0).fill('Sambhav')
  await inputs.nth(1).fill('refresh2024')
  await page.click('.card button:has-text("Sign in")')
  await page.waitForSelector('.sidebar', { timeout: 15000 })

  const voidCheck = await page.evaluate(async () => {
    const tx = await window.api.listTransactions({})
    const sale = (tx.transactions || []).find((t) => t.type === 'restaurant')
    const r = await window.api.refundTransaction({
      transactionId: sale.id,
      amount: 50,
      reason: 'qa'
    })
    const tx2 = await window.api.listTransactions({})
    const refundRow = (tx2.transactions || []).find((t) => t.type === 'refund')
    const voided = await window.api.voidTransaction({
      transactionId: refundRow.id,
      reason: 'should be refused'
    })
    return { refunded: r?.success !== false, voidResult: voided }
  })
  check('P1-4 refund created', voidCheck.refunded)
  check(
    'P1-4 voiding a refund is refused',
    voidCheck.voidResult?.success === false,
    voidCheck.voidResult?.error || JSON.stringify(voidCheck.voidResult)
  )
  await ownerTab(page, 'Transactions')
  await shot(page, 'verify', '04-transactions-products')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} finally {
  await app.close()
  cleanup()
}
