// Verifies the last two features end-to-end, through the UI:
//   1. Inventory movement history is reachable and reads correctly.
//   2. Selling a membership to an existing customer no longer duplicates them.
// Both had tested handlers but no UI; this proves the renderer actually uses them.
import { launchApp, completeSetup, logout, loginStaff, shot, OWNER } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'verify5' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const ownerLogin = async () => {
  await page.click('button:has-text("Owner / Admin Login")')
  const li = page.locator('.card input')
  await li.nth(0).fill(OWNER.name)
  await li.nth(1).fill(OWNER.password)
  await page.click('.card button:has-text("Sign in")')
  await page.waitForSelector('.sidebar', { timeout: 15000 })
}
const tab = async (label) => {
  await page.click(`.nav-item:has-text("${label}")`)
  await page.waitForTimeout(700)
}
// Escape does not log out while focus is in a text field (by design).
const logoutViaButton = async () => {
  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
}

try {
  await completeSetup(page)

  // Price a membership and a pool item, and give the pool item some stock.
  const seed = await page.evaluate(async () => {
    const prods = (await window.api.listProducts()).products || []
    const monthly = prods.find((p) => p.category === 'membership' && p.duration_days === 30)
    await window.api.updatePrice({ productId: monthly.id, newPrice: 2500 })
    const pool = (await window.api.listPoolInventory()).items || []
    await window.api.updatePoolItem({ itemId: pool[0].id, fields: { sellingPrice: 250 } })
    await window.api.restockPoolItem({ itemId: pool[0].id, quantity: 20 })
    return { monthly: monthly.id, pool: pool[0].id, poolName: pool[0].item }
  })

  // Generate a movement of every kind: restock (above), a sale, an adjustment.
  await page.evaluate(async (s) => {
    await window.api.sellPoolItem({
      itemId: s.pool,
      quantity: 3,
      paymentMethod: 'cash',
      customerName: 'Walk-in'
    })
    await window.api.adjustPoolItem({
      itemId: s.pool,
      newQuantity: 15,
      reason: 'stock count'
    })
  }, seed)

  // ---------- 1. Inventory history through the UI ----------
  await tab('Inventory')
  const historyButtons = await page.locator('button:has-text("History")').count()
  check('History control exists on inventory rows', historyButtons > 0, `${historyButtons} buttons`)

  if (historyButtons > 0) {
    await page.locator('button:has-text("History")').first().click()
    await page.waitForTimeout(900)
    const panel = await page.locator('.content').innerText()
    await shot(page, 'verify5', '01-inventory-history')

    check('history panel lists a Restock', /Restock/i.test(panel))
    check('history panel lists a Sale', /Sale/i.test(panel))
    check('history panel lists an Adjustment', /Adjustment/i.test(panel))
    check(
      'history shows the adjustment reason',
      /stock count/i.test(panel),
      panel.replace(/\n/g, ' ').slice(0, 140)
    )
    check('history shows a negative movement for the sale', /-\s?3|−3/.test(panel))

    // Only one panel at a time: opening Restock must dismiss History.
    await page.locator('button:has-text("Restock")').first().click()
    await page.waitForTimeout(600)
    const afterRestock = await page.locator('.content').innerText()
    const stillShowingHistory = /Adjustment/i.test(afterRestock) && /stock count/i.test(afterRestock)
    check('opening another panel closes History', !stillShowingHistory)
  }

  // Restaurant screen has the same control.
  await tab('Restaurant')
  const restHistory = await page.locator('button:has-text("History")').count()
  check('History control exists on restaurant rows', restHistory > 0, `${restHistory} buttons`)

  // ---------- 2. Membership sale no longer duplicates a member ----------
  await logoutViaButton()
  await loginStaff(page)

  // Walk the 5-step wizard to the Customer step. Step 0 and 1 are <select>s
  // (Type, Product); step 2 has Customer name + Phone inputs.
  const wizardToCustomer = async (customer, phone) => {
    await page.click('.tab:has-text("New Transaction")')
    await page.waitForTimeout(900)
    await page.locator('select').first().selectOption('Membership')
    await page.waitForTimeout(400)
    await page.click('button:has-text("Continue")')
    await page.waitForTimeout(600)
    await page.click('button:has-text("Continue")') // product is preselected
    await page.waitForTimeout(600)
    await page.fill('input[placeholder="Full name"]', customer)
    await page.fill('input[placeholder="98XXXXXXXX"]', phone)
    await page.waitForTimeout(400)
  }
  // Customer -> Payment -> Confirm -> save.
  const finishSale = async () => {
    await page.click('button:has-text("Continue")')
    await page.waitForTimeout(600)
    await page.click('button:has-text("Continue")')
    await page.waitForTimeout(600)
    await page.click('button:has-text("Confirm")')
    await page.waitForTimeout(1800)
  }

  await wizardToCustomer('Hari Shrestha', '9841000001')
  await shot(page, 'verify5', '02-wizard-customer-step')
  await finishSale()
  await shot(page, 'verify5', '03-first-membership-saved')

  const afterFirst = await page.evaluate(async () => {
    const r = await window.api.searchMembers({ query: 'Hari' })
    return (r.members || []).length
  })
  check('first membership sale created exactly one member', afterFirst === 1, `members=${afterFirst}`)

  // Now sell the SAME person another membership — the duplicate-bug scenario.
  const matchOffered = await page.evaluate(async () => {
    const r = await window.api.findMemberMatches({ name: 'Hari Shrestha', phone: '9841000001' })
    return { count: (r.matches || []).length, matchedOn: r.matches?.[0]?.matchedOn }
  })
  check(
    'findMemberMatches finds the existing customer',
    matchOffered.count === 1 && matchOffered.matchedOn === 'phone',
    JSON.stringify(matchOffered)
  )

  await page.click('.tab:has-text("Home")')
  await page.waitForTimeout(400)
  await wizardToCustomer('Hari Shrestha', '9841000001')
  // Continue through Payment to Confirm, then save — the match picker must
  // interrupt here rather than silently creating a second Hari Shrestha.
  await page.click('button:has-text("Continue")')
  await page.waitForTimeout(600)
  await page.click('button:has-text("Continue")')
  await page.waitForTimeout(600)
  await page.click('button:has-text("Confirm")')
  await page.waitForTimeout(1500)
  const wizardText = await page.locator('.content').innerText()
  await shot(page, 'verify5', '04-existing-member-offered')
  check(
    'wizard offers the existing member instead of duplicating',
    /this is them|none of these/i.test(wizardText),
    wizardText.replace(/\n/g, ' ').slice(0, 160)
  )

  // Choosing the existing member must NOT create a second record.
  const thisIsThem = page.locator('button:has-text("This is them")')
  if (await thisIsThem.count()) {
    await thisIsThem.first().click()
    await page.waitForTimeout(1800)
    await shot(page, 'verify5', '05-merged-into-existing')
    const after = await page.evaluate(async () => {
      const r = await window.api.searchMembers({ query: 'Hari' })
      const m = (r.members || [])[0]
      const full = m ? await window.api.getMember({ memberId: m.id }) : null
      return { members: (r.members || []).length, active: !!full?.activeMembership }
    })
    check(
      'second sale reused the member — still exactly one Hari Shrestha',
      after.members === 1,
      `members=${after.members}`
    )
    check('the reused member has an active membership', after.active)
  } else {
    check('"This is them" button present', false, 'match picker did not render')
  }

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
