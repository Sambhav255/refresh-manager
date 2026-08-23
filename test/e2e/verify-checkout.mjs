// Verifies the unified one-screen till (StaffTill) against the sale model, through
// the real UI — every claim here is something reception does at the desk:
//
//   * quantity +/- moves the running total (the "plus minus so I can just do
//     one, two, three, four and it reflects on the bill" ask);
//   * a ticket and a pair of goggles are ONE transaction and one receipt, and
//     the goggles come off the shelf;
//   * a discount without a reason is refused where it is typed, not after the
//     customer has been told a price;
//   * a part payment leaves the right balance behind;
//   * the two-step membership picker still files exactly one member;
//   * the member photo step is gone and Day Pass / Day Package are renamed.
import { launchApp, completeSetup, loginStaff, shot, seedShop, enableUnifiedTill } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'checkout' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const money = (text) => Number(String(text).replace(/[^\d]/g, ""))
const dueAmount = async () =>
  money(await page.locator('.amount-box:has(.a-label:has-text("Due")) .a-value').innerText())
const chargeBtn = () => page.locator('.card button:has-text("Charge")').last()
const cartLine = () => page.locator(".cart-line").first()
const openTill = async () => {
  await page.click('.tab:has-text("New Transaction")')
  await page.waitForTimeout(900)
}
const tillTab = async (label) => {
  await page.click(`.seg button:has-text("${label}")`)
  await page.waitForTimeout(400)
}
const addEntry = async (name) => {
  await tillTab("Entry")
  await page.locator("button.card").filter({ hasText: name }).first().click()
  await page.waitForTimeout(500)
}
const addShop = async (name) => {
  await tillTab("Shop")
  await page.locator("button.card").filter({ hasText: name }).first().click()
  await page.waitForTimeout(500)
}
// The saved card offers a fresh sale; using it (rather than the tab) also proves
// reset() clears the basket between customers.
const nextCustomer = async () => {
  await page.click('.card button:has-text("New sale")')
  await page.waitForTimeout(700)
}

try {
  await completeSetup(page)
  // A fresh database seeds no catalogue: build the small shop to sell from.
  // Pool Day Pass 300, Whole Package 1200, Gym Only (30 days) 2500,
  // Goggles 250 with 20 in stock.
  const ids = await seedShop(page)

  await enableUnifiedTill(page)
  await loginStaff(page)

  // ---------- Renaming: no more "what's the difference?" ----------
  await openTill()
  await tillTab('Entry')
  const categoryHeaders = await page
    .locator('.card .sub')
    .filter({ hasText: 'Ticket' })
    .allInnerTexts()
  check(
    'the entry catalog is renamed to Entry Ticket / Combo Ticket',
    categoryHeaders.includes('Entry Ticket') &&
      categoryHeaders.includes('Combo Ticket') &&
      !categoryHeaders.some((h) => /day pass|day package/i.test(h)),
    categoryHeaders.join(' / ')
  )

  // ---------- Quantity +/- moves the total ----------
  await addEntry('Pool Day Pass')
  const oneAdult = await dueAmount()
  check('a Pool Day Pass in the basket shows Rs. 300 due', oneAdult === 300, `Rs. ${oneAdult}`)

  await cartLine().locator('[aria-label="Increase quantity"]').click()
  await page.waitForTimeout(500)
  await cartLine().locator('[aria-label="Increase quantity"]').click()
  await page.waitForTimeout(500)
  const three = await dueAmount()
  check('+ raises the quantity and the total follows', three === 900, `Rs. ${three}`)
  await shot(page, 'checkout', '01-basket-quantity')

  await cartLine().locator('[aria-label="Decrease quantity"]').click()
  await page.waitForTimeout(500)
  const two = await dueAmount()
  check('− lowers the quantity and the total follows', two === 600, `Rs. ${two}`)

  // ---------- Escape must not discard an in-progress cart ----------
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const stillOnTill =
    (await page.locator('.botnav').count()) > 0 &&
    (await page.locator('.amount-box:has(.a-label:has-text("Due"))').count()) > 0
  check(
    'Escape with items in the cart does not log out',
    stillOnTill,
    stillOnTill ? '' : 'landed on login or lost the till'
  )

  // ---------- A ticket and an add-on in ONE sale ----------
  await cartLine().locator('[aria-label="Decrease quantity"]').click()
  await page.waitForTimeout(400)
  await addShop('Goggles')
  const withGoggles = await dueAmount()
  check(
    'a pool add-on joins the same basket as the ticket',
    withGoggles === 550,
    `Rs. ${withGoggles} (expected 300 + 250)`
  )
  await shot(page, 'checkout', '02-ticket-plus-addon')

  await page.fill('input[placeholder="Walk-in"]', 'Basket Test')
  await chargeBtn().click()
  await page.waitForTimeout(1800)

  const mixed = await page.evaluate(async (seed) => {
    const tx = (await window.api.listTransactions({})).transactions || []
    const mine = tx.filter((t) => t.customer === 'Basket Test')
    const sale = mine.length === 1 ? await window.api.getSale({ saleId: mine[0].id }) : null
    const items = (await window.api.listPoolInventory()).items || []
    const goggles = items.find((i) => i.id === seed.poolItemId)
    return {
      rows: mine.length,
      amount: mine[0]?.amount,
      lines: sale?.sale?.lines?.length,
      type: mine[0]?.type,
      stock: goggles?.stock
    }
  }, ids)
  check(
    'the ticket and the goggles are ONE transaction, not two',
    mixed.rows === 1 && mixed.lines === 2,
    `rows=${mixed.rows} lines=${mixed.lines}`
  )
  check(
    'that one transaction is worth the sum of the basket',
    mixed.amount === 550,
    `amount=${mixed.amount} type=${mixed.type}`
  )
  check('the add-on came off the shelf', mixed.stock === 19, `goggles stock=${mixed.stock}`)

  // ---------- A discount without a reason is refused where it is typed ----------
  await nextCustomer()
  await addEntry('Pool Day Pass')
  await cartLine().locator('button:has-text("Discount")').click()
  await page.waitForTimeout(300)
  await cartLine().locator('input[placeholder="Rs. off"]').fill('100')
  await page.waitForTimeout(600)
  const cartText = await page.locator('.card').filter({ hasText: 'Cart' }).innerText()
  const blocked = await chargeBtn().isDisabled()
  check(
    'a discount with no reason is refused visibly, before Charge',
    /reason is required/i.test(cartText) && blocked,
    `blocked=${blocked}`
  )
  await shot(page, 'checkout', '04-discount-needs-reason')

  await cartLine().locator('input[placeholder="Reason for the discount"]').fill('Owner approved')
  await page.waitForTimeout(800)
  const discounted = await dueAmount()
  const unblocked = !(await chargeBtn().isDisabled())
  check(
    'with a reason the discount applies and the sale can go on',
    discounted === 200 && unblocked,
    `Rs. ${discounted} blocked=${!unblocked}`
  )

  await page.fill('input[placeholder="Walk-in"]', 'Discount Test')
  await chargeBtn().click()
  await page.waitForTimeout(1800)
  const discountSale = await page.evaluate(async () => {
    const tx = (await window.api.listTransactions({})).transactions || []
    const row = tx.find((t) => t.customer === 'Discount Test')
    const sale = row ? await window.api.getSale({ saleId: row.id }) : null
    return { amount: row?.amount, reason: sale?.sale?.lines?.[0]?.discountReason }
  })
  check(
    'the discount and its reason are both on the saved sale',
    discountSale.amount === 200 && discountSale.reason === 'Owner approved',
    JSON.stringify(discountSale)
  )

  // ---------- Part payment leaves the right balance ----------
  await nextCustomer()
  await addEntry('Pool Day Pass')
  await page.fill('input[placeholder="Walk-in"]', 'Part Pay')
  await page.fill('input[placeholder="Full amount"]', '100')
  await page.waitForTimeout(500)
  const payBar = await page.locator('.card').filter({ hasText: 'Part pay' }).innerText()
  check(
    'the till shows what is left to collect before Charge',
    /200/.test(payBar) && /remaining/i.test(payBar),
    payBar.replace(/\n/g, ' ').slice(0, 110)
  )
  await shot(page, 'checkout', '05-part-payment')
  await chargeBtn().click()
  await page.waitForTimeout(1800)
  const savedCard = await page.locator('.card').first().innerText()
  check(
    'the saved sale says the balance is still owed',
    /still to collect/i.test(savedCard),
    savedCard.replace(/\n/g, ' ').slice(0, 110)
  )
  await shot(page, 'checkout', '06-balance-owed')

  const partPaid = await page.evaluate(async () => {
    const tx = (await window.api.listTransactions({})).transactions || []
    const row = tx.find((t) => t.customer === 'Part Pay')
    const sale = row ? await window.api.getSale({ saleId: row.id }) : null
    const out = await window.api.listOutstanding({})
    return {
      total: sale?.sale?.total,
      paid: sale?.sale?.paid,
      balance: sale?.sale?.balance,
      outstanding: (out.sales || []).some((s) => s.customer === 'Part Pay')
    }
  })
  check(
    'part payment writes total 300, paid 100, balance 200',
    partPaid.total === 300 && partPaid.paid === 100 && partPaid.balance === 200,
    JSON.stringify(partPaid)
  )
  check('the balance shows up as money still owed', partPaid.outstanding)

  // ---------- Membership: two questions, one member, no photo step ----------
  await nextCustomer()
  await tillTab('Member')
  const planOptions = await page
    .locator('.field:has(label:text-is("Membership type")) select option')
    .allInnerTexts()
  const durationShown = await page.locator('.field:has(label:text-is("How long")) select').count()
  check(
    'membership asks for the type first, then the duration',
    durationShown === 0 &&
      planOptions.includes('Gym Only') &&
      !planOptions.some((o) => o.includes('—')),
    `plans=${planOptions.join('/')} durationSelects=${durationShown}`
  )
  await page.locator('.field:has(label:text-is("Membership type")) select').selectOption('Gym Only')
  await page.waitForTimeout(400)
  const durationAfterPlan = await page.locator('.field:has(label:text-is("How long")) select').count()
  const durationOptions = await page
    .locator('.field:has(label:text-is("How long")) select option')
    .allInnerTexts()
  check(
    'choosing a type reveals the duration step',
    durationAfterPlan === 1 && durationOptions.some((o) => /Monthly/i.test(o)),
    `durationSelects=${durationAfterPlan} opts=${durationOptions.join('/')}`
  )
  await shot(page, 'checkout', '07-membership-two-step')

  await page.locator('.field:has(label:text-is("How long")) select').selectOption({ index: 1 })
  await page.waitForTimeout(400)
  const memberPanel = await page.locator('.card').first().innerText()
  check(
    'the member photo step is gone from the flow',
    !/member photo|take photo/i.test(memberPanel),
    memberPanel.replace(/\n/g, ' ').slice(0, 110)
  )
  await page.fill('input[placeholder="Full name"]', 'Sita Rai')
  await page.fill('input[placeholder="98XXXXXXXX"]', '9841000123')
  await chargeBtn().click()
  await page.waitForTimeout(2000)
  await shot(page, 'checkout', '08-membership-saved')

  const member = await page.evaluate(async () => {
    const r = await window.api.searchMembers({ query: 'Sita' })
    const m = (r.members || [])[0]
    const full = m ? await window.api.getMember({ memberId: m.id }) : null
    return { count: (r.members || []).length, active: !!full?.activeMembership }
  })
  check(
    'the two-step membership created exactly one member',
    member.count === 1,
    `members=${member.count}`
  )
  check('that member has an active membership', member.active)

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
