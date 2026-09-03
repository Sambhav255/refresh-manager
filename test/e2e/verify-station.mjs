// Verifies the staff station feature after the home grid stopped being trimmed
// by a MutationObserver matching tile titles in the DOM: StaffHome now takes a
// `hiddenTiles` prop of tile ids and simply does not render them.
//
// The checks that matter are the structural ones — a station's tiles must be
// absent from the DOM rather than present-and-hidden, and must stay absent once
// the async counts land, which is the only reason the observer existed. Plus
// the picker cards are now real <button>s, so they are keyboard reachable.
import { launchApp, completeSetup, logout, loginStaff, seedShop, shot, STAFF } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'station' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// Tiles the pool desk has and the restaurant does not.
const POOL_ONLY = ['New Transaction', 'Inventory', 'Bookings', 'Sell Item']

// Signs in and stops at whatever comes next. loginStaff() answers the station
// picker for you, and several checks below are about the picker itself.
const signInStaff = async () => {
  await page.click('button:has-text("Staff Login")')
  const namePick = page.locator(`.card button:has-text("${STAFF.name}")`)
  if (await namePick.count()) await namePick.first().click()
  await page.locator('.card input').first().fill(STAFF.pin)
  await page.waitForTimeout(1200)
}

// Escape only logs out when the focus is not in a field, so drop focus first.
const signOut = async () => {
  await page.evaluate(() => document.activeElement?.blur())
  await logout(page)
}

const tileTitles = () => page.locator('.tiles .t-title').allInnerTexts()
const activeTab = () => page.locator('.botnav .tab.active').innerText()
const onRestaurantTill = async () => {
  const kitchenActive = await page.locator('.seg button.active:has-text("Kitchen")').count()
  const chargeBtn = await page.locator('.card button:has-text("Charge")').count()
  return kitchenActive > 0 || chargeBtn > 0
}
const goHome = async () => {
  await page.locator('.botnav .tab').filter({ hasText: 'Home' }).first().click()
  await page.waitForTimeout(1500)
}

const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    return {
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className : '',
      text: (el.innerText || '').replace(/\s+/g, ' ').trim()
    }
  })

// Tab forward from the top of the document until the named station option holds
// focus. Returns what is focused, or null if Tab never got there.
const tabToStation = async (label) => {
  await page.evaluate(() => document.activeElement?.blur())
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    const f = await focused()
    if (f && /\btile\b/.test(f.cls) && f.text.startsWith(label)) return f
  }
  return null
}

try {
  await completeSetup(page)
  // A fresh database seeds no catalogue, and the restaurant landing screen is
  // the POS — give it a menu so it renders as it would in service.
  await seedShop(page)
  await signOut()

  // ---------- The station options are buttons and take the keyboard ----------
  await signInStaff()
  await page.waitForSelector('.tiles .tile', { timeout: 15000 })
  const optionTags = await page
    .locator('.tiles > *')
    .evaluateAll((els) => els.map((e) => e.tagName))
  check(
    'station options are <button>s, not clickable divs',
    optionTags.length === 2 && optionTags.every((t) => t === 'BUTTON'),
    optionTags.join('/')
  )
  check('they still render as tile cards', (await page.locator('.tiles button.tile').count()) === 2)
  await shot(page, 'station', '01-picker')

  const poolFocus = await tabToStation('Pool desk')
  check(
    'Tab reaches the Pool desk option',
    poolFocus?.tag === 'BUTTON',
    poolFocus ? poolFocus.tag : 'never focused'
  )
  await page.keyboard.press('Enter')
  await page.waitForSelector('.botnav', { timeout: 15000 })
  check('Enter activates the focused station option', (await page.locator('.botnav').count()) === 1)

  // ---------- Pool desk: lands on New Transaction (unified till), no Restaurant POS tile ----------
  const poolTab = await activeTab()
  check('Pool desk lands on New Transaction', /New Transaction/i.test(poolTab), poolTab)
  await goHome()
  let titles = await tileTitles()
  check(
    'the Restaurant POS tile is absent for Pool desk',
    !titles.includes('Restaurant POS'),
    titles.join(' | ')
  )
  check(
    'every pool tile is present',
    POOL_ONLY.every((t) => titles.includes(t)) && titles.length === 7,
    `${titles.length} tiles: ${titles.join(' | ')}`
  )
  const inlineHidden = await page.locator('.tiles .tile[style*="display"]').count()
  check(
    'the trimmed tile is gone from the DOM, not display:none',
    inlineHidden === 0,
    `${inlineHidden} tiles carry an inline display`
  )

  // The observer existed because StaffHome re-renders as its counts arrive. A
  // prop survives that on its own — confirm nothing reappears.
  await page.waitForTimeout(1800)
  titles = await tileTitles()
  check(
    'the grid stays trimmed after the async counts land',
    titles.length === 7 && !titles.includes('Restaurant POS'),
    titles.join(' | ')
  )
  await shot(page, 'station', '02-pool-home')

  // ---------- Switching station mid-shift, without logging out ----------
  await page.locator('button.btn').filter({ hasText: 'Restaurant' }).first().click()
  await page.waitForTimeout(1200)
  check('switching to Restaurant lands on the till', (await onRestaurantTill()))
  const switchedTab = await activeTab()
  check('the bottom nav follows the station', /Restaurant/i.test(switchedTab), switchedTab)
  await shot(page, 'station', '03-switched-to-restaurant')

  await page.locator('.botnav .tab').filter({ hasText: 'Home' }).first().click()
  await page.waitForTimeout(1500)
  titles = await tileTitles()
  check(
    'the pool-only tiles are absent for Restaurant',
    POOL_ONLY.every((t) => !titles.includes(t)),
    titles.join(' | ')
  )
  check(
    'the Restaurant POS tile is present for Restaurant',
    titles.includes('Restaurant POS') && titles.length === 4,
    `${titles.length} tiles: ${titles.join(' | ')}`
  )
  await shot(page, 'station', '04-restaurant-home')

  // ---------- The station survives a logout ----------
  await signOut()
  await signInStaff()
  await page.waitForSelector('.botnav, .tiles button.tile', { timeout: 15000 })
  check(
    're-login does not ask for the station again',
    (await page.locator('.tiles button.tile').count()) === 0
  )
  check('re-login lands back on the remembered Restaurant till', (await onRestaurantTill()))

  // ---------- Space activates too, and a fresh Restaurant pick lands on the POS ----------
  await page.evaluate(() => window.sessionStorage.clear())
  await signOut()
  await signInStaff()
  await page.waitForSelector('.tiles button.tile', { timeout: 15000 })
  check(
    'clearing the remembered station brings the picker back',
    (await page.locator('.tiles button.tile').count()) === 2
  )
  const restFocus = await tabToStation('Restaurant')
  check(
    'Tab reaches the Restaurant option',
    restFocus?.tag === 'BUTTON',
    restFocus ? restFocus.tag : 'never focused'
  )
  await page.keyboard.press('Space')
  await page.waitForSelector('.botnav', { timeout: 15000 })
  check(
    'Space activates the option and Restaurant lands on the till',
    (await onRestaurantTill())
  )
  await shot(page, 'station', '05-restaurant-via-keyboard')

  // ---------- The shared harness helper still drives the picker ----------
  // Other suites call loginStaff(), which clicks the option by its text; that
  // has to keep working now the options are buttons.
  await page.evaluate(() => window.sessionStorage.clear())
  await signOut()
  await loginStaff(page, 'Pool desk')
  await page.waitForTimeout(1200)
  const helperTab = await activeTab()
  await goHome()
  const helperTitles = await tileTitles()
  check(
    'harness loginStaff() still picks a station',
    /New Transaction/i.test(helperTab) && !helperTitles.includes('Restaurant POS'),
    `${helperTab} · ${helperTitles.length} tiles`
  )

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} finally {
  await app.close()
  cleanup()
}
