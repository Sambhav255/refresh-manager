// Playwright-driven Electron harness for manual QA sweeps.
//
// Every launch gets its own --user-data-dir, so a run never touches the real
// refresh.db in ~/Library/Application Support and several agents can drive the
// app at once without tripping the single-instance lock.

import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const MAIN = join(ROOT, 'out/main/index.js')

export const OWNER = { name: 'Sambhav', password: 'refresh2024' }
export const STAFF = { name: 'Reception', pin: '4821' }

// Screenshots land under docs/qa/screenshots/<area>/NN-name.png
export function shotDir(area) {
  const dir = join(ROOT, 'docs/qa/screenshots', area)
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function launchApp({ area = 'misc', keepData = null } = {}) {
  const userDataDir = keepData || mkdtempSync(join(tmpdir(), `refresh-e2e-${area}-`))
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

  return {
    app,
    page,
    userDataDir,
    errors,
    cleanup: () => rmSync(userDataDir, { recursive: true, force: true })
  }
}

// First run shows the setup wizard; complete it to get an owner + staff account.
export async function completeSetup(page) {
  await page.waitForSelector('text=Welcome to Refresh Manager', { timeout: 20000 })
  const inputs = page.locator('.card input')
  await inputs.nth(0).fill(OWNER.name)
  await inputs.nth(1).fill(OWNER.password)
  await inputs.nth(2).fill(OWNER.password)
  await inputs.nth(3).fill(STAFF.name)
  await inputs.nth(4).fill(STAFF.pin)
  await page.click('button:has-text("Complete setup")')
  await page.waitForSelector('.sidebar', { timeout: 20000 })
}

export async function logout(page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
}

// The admin username is now a <select> of the account names when any exist —
// login matches the name exactly, so typing it was a real source of "incorrect
// password". Falls back to the free-text field when the roster is unavailable.
export async function loginOwner(page, password = OWNER.password) {
  await page.click('button:has-text("Owner / Admin Login")')
  await page.waitForTimeout(400)
  const select = page.locator('.card select')
  if (await select.count()) {
    await select.first().selectOption({ label: OWNER.name })
    await page.locator('.card input').first().fill(password)
  } else {
    const inputs = page.locator('.card input')
    await inputs.nth(0).fill(OWNER.name)
    await inputs.nth(1).fill(password)
  }
  await page.click('.card button:has-text("Sign in")')
  await page.waitForSelector('.sidebar', { timeout: 15000 })
}

// After the PIN, staff now pick a station (Pool desk / Restaurant) the first
// time on a machine — it sets the landing screen and which tiles show. The
// bottom nav only appears once that is answered, so a script that just types a
// PIN and waits for .botnav would hang.
export async function loginStaff(page, station = 'Pool desk') {
  await page.click('button:has-text("Staff Login")')
  // With more than one staff member the PIN is preceded by a name picker.
  const namePick = page.locator(`.card button:has-text("${STAFF.name}")`)
  if (await namePick.count()) await namePick.first().click()
  await page.locator('.card input').first().fill(STAFF.pin)
  await page.waitForTimeout(900)
  // The station options are clickable cards, not <button>s, so match on text.
  const stationCard = page.locator(`text=${station}`)
  if (await stationCard.count()) await stationCard.first().click()
  await page.waitForSelector('.botnav', { timeout: 15000 })
}

export async function ownerTab(page, label) {
  await page.click(`.nav-item:has-text("${label}")`)
  await page.waitForTimeout(600)
}

// Turn on the one-screen till (StaffTill) via owner Settings. Ends on the login
// screen so the next call can be loginStaff.
export async function enableUnifiedTill(page) {
  const onLogin = await page.locator('text=Owner / Admin Login').count()
  if (onLogin) await loginOwner(page)
  await ownerTab(page, 'Settings')
  await page.click('.settings-card:has-text("One-screen till")')
  await page.waitForTimeout(600)
  const tillToggle = page.locator('label:has-text("Use the one-screen till") input[type="checkbox"]')
  if (!(await tillToggle.isChecked())) {
    await tillToggle.click()
    await page.waitForTimeout(800)
  }
  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
}

export async function shot(page, area, name) {
  const path = join(shotDir(area), `${name}.png`)
  await page.screenshot({ path })
  return path
}

// A fresh database now seeds no catalogue at all — the 34 pre-priced-at-zero
// rows were removed deliberately (they were clutter, and every one being
// unpriced is what left the staff Sell Item screen permanently empty).
//
// So a script that needs something to sell has to create it. This builds the
// same small shop every suite used to inherit from the seed: three products,
// one priced pool item with stock, and one menu item linked to restaurant
// stock. Returns the ids so a caller can price or sell them directly.
export async function seedShop(page) {
  return page.evaluate(async () => {
    const dayPass = await window.api.addProduct({
      name: 'Pool Day Pass',
      category: 'day_pass',
      price: 300
    })
    const pkg = await window.api.addProduct({
      name: 'Whole Package',
      category: 'day_package',
      price: 1200
    })
    const monthly = await window.api.addProduct({
      name: 'Gym Only',
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
    const menu = await window.api.addMenuItem({
      name: 'Tea',
      category: 'bev',
      price: 50,
      inventoryItemId: rInv.itemId
    })

    return {
      dayPassId: dayPass.productId,
      packageId: pkg.productId,
      monthlyId: monthly.productId,
      poolItemId: pool.itemId,
      restaurantItemId: rInv.itemId,
      menuId: menu.id
    }
  })
}
