// Verifies the rebuilt staff checkout screen against the sale model, through
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
import { launchApp, completeSetup, loginStaff, shot, seedShop } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'checkout' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// Rs. 1,250 -> 1250. Reading the value span, not the whole box, keeps the
// label's own digits out of the number.
const money = (text) => Number(String(text).replace(/[^\d]/g, ''))
const lastAmount = async () =>
  money(await page.locator('.amount-box').last().locator('.a-value').innerText())
const continueBtn = () => page.locator('.card button:has-text("Continue")')
const goOn = async (times = 1) => {
  for (let i = 0; i < times; i++) {
    await continueBtn().click()
    await page.waitForTimeout(500)
  }
}
const openTill = async () => {
  await page.click('.tab:has-text("New Transaction")')
  await page.waitForTimeout(900)
}
// The saved card offers a fresh sale; using it (rather than the tab) also proves
// reset() clears the basket between customers.
const nextCustomer = async () => {
  await page.click('.card button:has-text("New transaction")')
  await page.waitForTimeout(700)
}

try {
  await completeSetup(page)
  // A fresh database seeds no catalogue: build the small shop to sell from.
  // Pool Day Pass 300, Whole Package 1200, Gym Only (30 days) 2500,
  // Goggles 250 with 20 in stock.
  const ids = await seedShop(page)

  await page.click('button:has-text("Log out")')
  await page.waitForSelector('text=Owner / Admin Login', { timeout: 10000 })
  await loginStaff(page)

  // ---------- Renaming: no more "what's the difference?" ----------
  await openTill()
  const typeOptions = await page.locator('.card select').first().locator('option').allInnerTexts()
  check(
    'the type dropdown is renamed to Entry Ticket / Combo Ticket',
    typeOptions.includes('Entry Ticket') &&
      typeOptions.includes('Combo Ticket') &&
      !typeOptions.some((t) => /day pass|day package/i.test(t)),
    typeOptions.join(' / ')
  )

  // ---------- Quantity +/- moves the total ----------
  await goOn() // Type -> Items, with the most-sold ticket already in the basket
  await page.waitForTimeout(400)
  const oneAdult = await lastAmount()
  check('the basket opens with the most-sold ticket in it', oneAdult === 300, `Rs. ${oneAdult}`)

  await page.click('button[aria-label="One more Pool Day Pass"]')
  await page.waitForTimeout(500)
  await page.click('button[aria-label="One more Pool Day Pass"]')
  await page.waitForTimeout(500)
  const three = await lastAmount()
  check('+ raises the quantity and the total follows', three === 900, `Rs. ${three}`)
  await shot(page, 'checkout', '01-basket-quantity')

  await page.click('button[aria-label="One less Pool Day Pass"]')
  await page.waitForTimeout(500)
  const two = await lastAmount()
  check('− lowers the quantity and the total follows', two === 600, `Rs. ${two}`)

  // ---------- A ticket and an add-on in ONE sale ----------
  await page.click('button[aria-label="One less Pool Day Pass"]')
  await page.waitForTimeout(400)
  await page.locator('.field:has(label:has-text("Add goggles")) select').selectOption({ index: 1 })
  await page.waitForTimeout(700)
  const withGoggles = await lastAmount()
  check(
    'a pool add-on joins the same basket as the ticket',
    withGoggles === 550,
    `Rs. ${withGoggles} (expected 300 + 250)`
  )
  await shot(page, 'checkout', '02-ticket-plus-addon')

  await goOn() // Items -> Customer
  await page.fill('input[placeholder="Full name"]', 'Basket Test')
  await goOn(2) // Customer -> Payment -> Confirm
  await shot(page, 'checkout', '03-confirm-mixed-basket')
  await page.click('.card button:has-text("Confirm")')
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
  await goOn()
  await page.locator('.card button:has-text("Discount")').first().click()
  await page.waitForTimeout(300)
  await page.fill('input[placeholder="Rs. off"]', '100')
  await page.waitForTimeout(600)
  const cardText = await page.locator('.card').first().innerText()
  const blocked = await continueBtn().isDisabled()
  check(
    'a discount with no reason is refused visibly, before the click',
    /reason is required/i.test(cardText) && blocked,
    `blocked=${blocked}`
  )
  await shot(page, 'checkout', '04-discount-needs-reason')

  await page.fill('input[placeholder="Reason for the discount"]', 'Owner approved')
  await page.waitForTimeout(800)
  const discounted = await lastAmount()
  const unblocked = !(await continueBtn().isDisabled())
  check(
    'with a reason the discount applies and the sale can go on',
    discounted === 200 && unblocked,
    `Rs. ${discounted} blocked=${!unblocked}`
  )

  await goOn() // Items -> Customer
  await page.fill('input[placeholder="Full name"]', 'Discount Test')
  await goOn(2)
  await page.click('.card button:has-text("Confirm")')
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
  await goOn(2) // Type -> Items -> Customer
  await page.fill('input[placeholder="Full name"]', 'Part Pay')
  await goOn() // -> Payment
  await page.click('.card button:has-text("Part payment")')
  await page.waitForTimeout(300)
  await page.fill('input[placeholder="e.g. 5000"]', '100')
  await page.waitForTimeout(500)
  const remaining = money(
    await page.locator('.amount-box:has-text("Remaining after this payment") .a-value').innerText()
  )
  check('the payment step shows what is left to collect', remaining === 200, `Rs. ${remaining}`)
  await shot(page, 'checkout', '05-part-payment')
  await goOn()
  await page.click('.card button:has-text("Confirm")')
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
  await page.locator('.card select').first().selectOption('Membership')
  await page.waitForTimeout(500)
  await goOn() // Type -> Plan
  const planOptions = await page
    .locator('.field:has(label:text-is("Membership type")) select option')
    .allInnerTexts()
  const durationShown = await page.locator('.field:has(label:text-is("How long")) select').count()
  check(
    'membership asks for the type first, then the duration',
    durationShown === 1 &&
      planOptions.includes('Gym Only') &&
      // The old single dropdown listed every plan × every length together.
      !planOptions.some((o) => o.includes('—')),
    `plans=${planOptions.join('/')} durationSelects=${durationShown}`
  )
  await shot(page, 'checkout', '07-membership-two-step')

  await goOn() // Plan -> Customer
  const customerStep = await page.locator('.card').first().innerText()
  check(
    'the member photo step is gone from the flow',
    !/member photo|take photo/i.test(customerStep),
    customerStep.replace(/\n/g, ' ').slice(0, 110)
  )
  await page.fill('input[placeholder="Full name"]', 'Sita Rai')
  await page.fill('input[placeholder="98XXXXXXXX"]', '9841000123')
  await goOn(2)
  await page.click('.card button:has-text("Confirm")')
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
