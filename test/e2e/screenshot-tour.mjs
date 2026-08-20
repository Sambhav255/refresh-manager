// A labeled screenshot tour of every screen in the app, for visual review —
// not an assertion suite. Seeds a small realistic shop (products, stock, a
// member, a booking) so screens show real content instead of empty states,
// then walks staff and owner through every tab, tile and settings sub-screen.
//
// Screenshots land in docs/qa/screenshots/app-tour/NN-name.png, numbered in
// the order a person would actually encounter them: setup, login, staff,
// owner, settings.
import { launchApp, shot, OWNER, STAFF } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'app-tour' })
let n = 0
const next = (name) => shot(page, 'app-tour', `${String(++n).padStart(2, '0')}-${name}`)
const tab = async (label) => {
  await page.click(`.nav-item:has-text("${label}")`)
  await page.waitForTimeout(600)
}

try {
  // ---------- Setup wizard ----------
  await page.waitForSelector('text=Welcome to Refresh Manager', { timeout: 20000 })
  await next('setup-wizard-blank')
  const setupInputs = page.locator('.card input')
  await setupInputs.nth(0).fill(OWNER.name)
  await setupInputs.nth(1).fill(OWNER.password)
  await setupInputs.nth(2).fill(OWNER.password)
  await setupInputs.nth(3).fill(STAFF.name)
  await setupInputs.nth(4).fill(STAFF.pin)
  await next('setup-wizard-filled')
  await page.click('button:has-text("Complete setup")')
  await page.waitForSelector('.sidebar', { timeout: 20000 })

  // ---------- Seed a small realistic shop ----------
  const seed = await page.evaluate(async () => {
    const dayPass = await window.api.addProduct({
      name: 'Pool Day Pass',
      category: 'day_pass',
      price: 300
    })
    const monthly = await window.api.addProduct({
      name: 'Gym Only Monthly',
      category: 'membership',
      durationDays: 30,
      price: 2500
    })
    const pool = await window.api.addPoolItem({
      name: 'Goggles',
      category: 'gear',
      variant: 'Adult',
      reorderLevel: 5,
      sellingPrice: 250
    })
    await window.api.restockPoolItem({ itemId: pool.itemId, quantity: 20 })
    const rInv = await window.api.addRestaurantItem({
      name: 'Tea leaves',
      category: 'bev',
      unit: 'kg',
      reorderLevel: 3
    })
    await window.api.restockRestaurantItem({ itemId: rInv.itemId, quantity: 40 })
    await window.api.addMenuItem({
      name: 'Tea',
      category: 'bev',
      price: 50,
      inventoryItemId: rInv.itemId
    })
    const member = await window.api.createMemberWithMembership({
      name: 'Anita Shrestha',
      phone: '9800000001',
      gender: 'female',
      productId: monthly.productId,
      paymentMethod: 'cash'
    })
    const booking = await window.api.createBooking({
      bookingName: 'Shrestha family swim party',
      contactPerson: 'Anita Shrestha',
      contactPhone: '9800000001',
      bookingDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      timeSlot: '4:00 PM - 6:00 PM',
      numPeople: 8,
      facilitiesBooked: 'pool',
      depositPaid: 3000,
      depositMethod: 'cash',
      totalExpected: 8000
    })
    return {
      dayPassId: dayPass.productId,
      poolItemId: pool.itemId,
      memberId: member.memberId,
      booking
    }
  })

  // A cash sale so Today's Log / End of Day / Reports / Transactions have a row.
  await page.evaluate(async (dayPassId) => {
    const cart = [{ kind: 'product', refId: dayPassId, tier: 'adult', quantity: 1 }]
    const quote = await window.api.quoteSale({ cart })
    await window.api.createSale({
      cart,
      payments: [{ method: 'cash', amount: quote.total }]
    })
  }, seed.dayPassId)

  // ---------- Log out, tour the login screen ----------
  await page.keyboard.press('Escape')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
  await next('login-home')

  await page.click('button:has-text("Staff Login")')
  await page.waitForTimeout(650)
  await next('login-staff-pin')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(650)

  await page.click('button:has-text("Owner / Admin Login")')
  await page.waitForTimeout(650)
  await next('login-owner')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(650)

  // ---------- Staff side: Pool desk ----------
  await page.click('button:has-text("Staff Login")')
  await page.locator('.card input').first().fill(STAFF.pin)
  await page.waitForTimeout(900)
  await next('staff-station-picker')
  await page.click('text=Pool desk')
  await page.waitForSelector('.botnav', { timeout: 15000 })
  await page.waitForTimeout(500)
  await next('staff-home-pool-desk')

  await page.click('.tab:has-text("New Transaction")')
  await page.waitForTimeout(500)
  await next('staff-new-transaction')

  await page.click('.tab:has-text("Members")')
  await page.waitForTimeout(500)
  await next('staff-member-search')

  await page.click('.tab:has-text("Today\'s Log")')
  await page.waitForTimeout(500)
  await next('staff-todays-log')

  await page.click('.tab:has-text("End of Day")')
  await page.waitForTimeout(500)
  await next('staff-end-of-day')

  await page.click('.tab:has-text("Home")')
  await page.waitForTimeout(650)
  const invTile = page.locator('.tile:has-text("Inventory")')
  if (await invTile.count()) {
    await invTile.first().click()
    await page.waitForTimeout(500)
    await next('staff-pool-inventory')
    await page.click('button:has-text("Back to home")')
    await page.waitForTimeout(650)
  }
  const bookTile = page.locator('.tile:has-text("Booking")')
  if (await bookTile.count()) {
    await bookTile.first().click()
    await page.waitForTimeout(500)
    await next('staff-bookings')
    await page.click('button:has-text("Back to home")')
    await page.waitForTimeout(650)
  }
  const sellTile = page.locator('.tile:has-text("Sell Item")')
  if (await sellTile.count()) {
    await sellTile.first().click()
    await page.waitForTimeout(500)
    await next('staff-sell-item')
    await page.click('button:has-text("Back to home")')
    await page.waitForTimeout(650)
  }

  // ---------- Staff side: Restaurant station ----------
  await page.click('.tab:has-text("Home")')
  await page.waitForTimeout(650)
  await page.locator('button:has-text("Restaurant")').first().click()
  await page.waitForTimeout(500)
  await next('staff-restaurant-pos')

  // ---------- Owner side ----------
  await page.keyboard.press('Escape')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
  await page.click('button:has-text("Owner / Admin Login")')
  await page.waitForTimeout(650)
  const ownerSelect = page.locator('.card select')
  if (await ownerSelect.count()) {
    await ownerSelect.first().selectOption({ label: OWNER.name })
    await page.locator('.card input').first().fill(OWNER.password)
  } else {
    const oi = page.locator('.card input')
    await oi.nth(0).fill(OWNER.name)
    await oi.nth(1).fill(OWNER.password)
  }
  await page.click('.card button:has-text("Sign in")')
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.waitForTimeout(500)
  await next('owner-dashboard')

  await tab('Transactions')
  await next('owner-transactions')

  await tab('Members')
  await next('owner-members')

  await tab('Bookings')
  await next('owner-bookings')

  await tab('Inventory')
  await next('owner-inventory')

  await tab('Restaurant')
  await next('owner-restaurant')

  await tab('Reports')
  await next('owner-reports')

  await tab('Settings')
  await next('owner-settings-hub')

  const settingsScreens = [
    ['Pricing manager', 'owner-settings-pricing'],
    ['Staff PINs', 'owner-settings-staff-admins'],
    ['WhatsApp number', 'owner-settings-whatsapp'],
    ['Backup settings', 'owner-settings-backup'],
    ['Restaurant menu', 'owner-settings-restaurant-menu'],
    ['Renewal reminders', 'owner-settings-renewal-reminders'],
    ['Business info', 'owner-settings-business-info'],
    ['Audit log', 'owner-settings-audit-log']
  ]
  for (const [cardTitle, shotName] of settingsScreens) {
    const card = page.locator(`.settings-card:has-text("${cardTitle}")`)
    if (!(await card.count())) continue
    await card.first().click()
    await page.waitForTimeout(600)
    await next(shotName)
    const back = page.locator('button:has-text("Back")')
    if (await back.count()) {
      await back.first().click()
    } else {
      await tab('Settings')
    }
    await page.waitForTimeout(650)
  }

  // ---------- The new recovery-code redemption UI ----------
  // Generate a real code so "Forgot your password?" appears on the login
  // screen, then walk the reset form itself.
  await tab('Settings')
  await page.click('.settings-card:has-text("Staff PINs")')
  await page.waitForSelector('text=Staff & Admins', { timeout: 10000 })
  const pwField = page.locator('input[placeholder="Your current password"]')
  await pwField.fill(OWNER.password)
  await page.click('button:has-text("Generate recovery code")')
  await page.waitForSelector('.recovery-code-value', { timeout: 10000 })
  const code = (await page.locator('.recovery-code-value').innerText()).trim()
  await next('owner-settings-recovery-code-shown')
  await page.click('button:has-text("I have written it down")')
  await page.waitForTimeout(650)

  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
  await page.click('button:has-text("Owner / Admin Login")')
  await page.waitForTimeout(650)
  await next('login-owner-with-forgot-password-link')
  await page.click('button:has-text("Forgot your password?")')
  await page.waitForTimeout(650)
  await next('login-recovery-form-blank')

  await page.locator('.card select').first().selectOption({ label: OWNER.name })
  await page.locator('.card input[placeholder="XXXXX-XXXXX-XXXXX-XXXXX"]').fill(code)
  const recoveryPasswordInputs = page.locator('.card input[type="password"]')
  await recoveryPasswordInputs.nth(0).fill('new-recovered-pass')
  await recoveryPasswordInputs.nth(1).fill('new-recovered-pass')
  await next('login-recovery-form-filled')
  await page.click('button:has-text("Reset password")')
  await page.waitForTimeout(700)
  await next('login-after-recovery-notice')
} catch (err) {
  console.log('Tour hit an error:', err.message)
  try {
    await shot(page, 'app-tour', '99-crash')
  } catch {
    /* window may already be gone */
  }
} finally {
  console.log(`\n${n} screenshots saved to docs/qa/screenshots/app-tour/`)
  if (errors.length) console.log('\nRenderer errors:\n' + errors.join('\n'))
  await app.close()
  cleanup()
}
