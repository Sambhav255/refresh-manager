// Phase 3 of 3 for the "month of history" demo dataset — the actual
// screenshot tour, walked against the profile seed-demo-month.mjs +
// backdate-demo-month.mjs already populated with ~30 days of realistic
// activity (see those two files for how it was built).
//
// Structured exactly like the original screenshot-tour.mjs (same screen
// order, same file names, same docs/qa/screenshots/app-tour/ destination —
// this REPLACES those screenshots), except:
//   - it seeds nothing itself (DEMO_DIR already has a month of history)
//   - the setup-wizard shots come from a separate, throwaway, unseeded
//     profile first, since a wizard can't be demoed against a DB that's
//     already past setup
//   - staff login now goes through a name picker (three staff exist, not
//     one), same as the harness's own loginStaff() handles
//
// Run: node test/e2e/demo-tour.mjs
import { launchApp, shot, OWNER, STAFF } from './harness.mjs'
import { DEMO_DIR } from './demo-data.mjs'

let n = 0
const next = (page, name) => shot(page, 'app-tour', `${String(++n).padStart(2, '0')}-${name}`)
const tab = async (page, label) => {
  await page.click(`.nav-item:has-text("${label}")`)
  await page.waitForTimeout(600)
}

// ---------- Setup wizard shots, from a throwaway unseeded profile ----------
{
  const { app, page, cleanup } = await launchApp({ area: 'app-tour-setup-throwaway' })
  try {
    await page.waitForSelector('text=Welcome to Refresh Manager', { timeout: 20000 })
    await next(page, 'setup-wizard-blank')
    const setupInputs = page.locator('.card input')
    await setupInputs.nth(0).fill(OWNER.name)
    await setupInputs.nth(1).fill(OWNER.password)
    await setupInputs.nth(2).fill(OWNER.password)
    await setupInputs.nth(3).fill(STAFF.name)
    await setupInputs.nth(4).fill(STAFF.pin)
    await next(page, 'setup-wizard-filled')
  } finally {
    await app.close()
    cleanup()
  }
}

// ---------- Everything else, against the seeded month of history ----------
const { app, page, errors } = await launchApp({ area: 'app-tour', keepData: DEMO_DIR })

try {
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 20000 })
  await next(page, 'login-home')

  await page.click('button:has-text("Staff Login")')
  await page.waitForTimeout(650)
  await next(page, 'login-staff-picker')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(650)

  await page.click('button:has-text("Owner / Admin Login")')
  await page.waitForTimeout(650)
  await next(page, 'login-owner')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(650)

  // ---------- Staff side: Pool desk ----------
  await page.click('button:has-text("Staff Login")')
  await page.waitForTimeout(400)
  const namePick = page.locator(`.card button:has-text("${STAFF.name}")`)
  if (await namePick.count()) await namePick.first().click()
  await page.locator('.card input').first().fill(STAFF.pin)
  await page.waitForTimeout(900)
  await next(page, 'staff-station-picker')
  await page.click('text=Pool desk')
  await page.waitForSelector('.botnav', { timeout: 15000 })
  await page.waitForTimeout(500)
  await next(page, 'staff-home-pool-desk')

  await page.click('.tab:has-text("New Transaction")')
  await page.waitForTimeout(500)
  await next(page, 'staff-new-transaction')

  await page.click('.tab:has-text("Members")')
  await page.waitForTimeout(500)
  await next(page, 'staff-member-search')

  await page.click('.tab:has-text("Today\'s Log")')
  await page.waitForTimeout(500)
  await next(page, 'staff-todays-log')

  await page.click('.tab:has-text("End of Day")')
  await page.waitForTimeout(500)
  await next(page, 'staff-end-of-day')

  await page.click('.tab:has-text("Home")')
  await page.waitForTimeout(650)
  const invTile = page.locator('.tile:has-text("Inventory")')
  if (await invTile.count()) {
    await invTile.first().click()
    await page.waitForTimeout(500)
    await next(page, 'staff-pool-inventory')
    await page.click('button:has-text("Back to home")')
    await page.waitForTimeout(650)
  }
  const bookTile = page.locator('.tile:has-text("Booking")')
  if (await bookTile.count()) {
    await bookTile.first().click()
    await page.waitForTimeout(500)
    await next(page, 'staff-bookings')
    await page.click('button:has-text("Back to home")')
    await page.waitForTimeout(650)
  }
  const sellTile = page.locator('.tile:has-text("Sell Item")')
  if (await sellTile.count()) {
    await sellTile.first().click()
    await page.waitForTimeout(500)
    await next(page, 'staff-sell-item')
    await page.click('button:has-text("Back to home")')
    await page.waitForTimeout(650)
  }

  // ---------- Staff side: Restaurant station ----------
  await page.click('.tab:has-text("Home")')
  await page.waitForTimeout(650)
  await page.locator('button:has-text("Restaurant")').first().click()
  await page.waitForTimeout(500)
  await next(page, 'staff-restaurant-pos')

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
  await next(page, 'owner-dashboard')

  await tab(page, 'Transactions')
  await next(page, 'owner-transactions')

  await tab(page, 'Members')
  await next(page, 'owner-members')

  await tab(page, 'Bookings')
  await next(page, 'owner-bookings')

  await tab(page, 'Inventory')
  await next(page, 'owner-inventory')

  await tab(page, 'Restaurant')
  await next(page, 'owner-restaurant')

  await tab(page, 'Reports')
  await next(page, 'owner-reports')

  await tab(page, 'Settings')
  await next(page, 'owner-settings-hub')

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
    await next(page, shotName)
    const back = page.locator('button:has-text("Back")')
    if (await back.count()) {
      await back.first().click()
    } else {
      await tab(page, 'Settings')
    }
    await page.waitForTimeout(650)
  }

  // ---------- The recovery-code redemption UI ----------
  await tab(page, 'Settings')
  await page.click('.settings-card:has-text("Staff PINs")')
  await page.waitForSelector('text=Staff & Admins', { timeout: 10000 })
  const pwField = page.locator('input[placeholder="Your current password"]')
  await pwField.fill(OWNER.password)
  await page.click('button:has-text("Generate recovery code")')
  await page.waitForSelector('.recovery-code-value', { timeout: 10000 })
  const code = (await page.locator('.recovery-code-value').innerText()).trim()
  await next(page, 'owner-settings-recovery-code-shown')
  await page.click('button:has-text("I have written it down")')
  await page.waitForTimeout(650)

  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
  await page.click('button:has-text("Owner / Admin Login")')
  await page.waitForTimeout(650)
  await next(page, 'login-owner-with-forgot-password-link')
  await page.click('button:has-text("Forgot your password?")')
  await page.waitForTimeout(650)
  await next(page, 'login-recovery-form-blank')

  await page.locator('.card select').first().selectOption({ label: OWNER.name })
  await page.locator('.card input[placeholder="XXXXX-XXXXX-XXXXX-XXXXX"]').fill(code)
  const recoveryPasswordInputs = page.locator('.card input[type="password"]')
  await recoveryPasswordInputs.nth(0).fill('new-recovered-pass')
  await recoveryPasswordInputs.nth(1).fill('new-recovered-pass')
  await next(page, 'login-recovery-form-filled')
  await page.click('button:has-text("Reset password")')
  await page.waitForTimeout(700)
  await next(page, 'login-after-recovery-notice')
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
  // Deliberately no cleanup() — DEMO_DIR is left in place in case a follow-up
  // pass or manual poking around is useful; re-run seed-demo-month.mjs to
  // start fresh.
}
