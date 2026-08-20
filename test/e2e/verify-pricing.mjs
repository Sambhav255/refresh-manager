// Drives the pricing manager the way an owner would: "kids six and under are
// 500, everyone else 700, and on Saturdays it's 500 for everyone."
//
// The point of the screen is not that the rules can be typed — it is that the
// owner can SEE what will be charged, including the part that surprises them:
// with only an adult/child pair, a Saturday-for-everyone rate does not reach
// adults, because a rate for an age group beats a rate for a day.
import { launchApp, completeSetup, logout, loginOwner, shot, seedShop } from './harness.mjs'

const { app, page, errors, cleanup } = await launchApp({ area: 'pricing' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const tab = async (label) => {
  await page.click(`.nav-item:has-text("${label}")`)
  await page.waitForTimeout(700)
}

const PRODUCT = 'Pool Day Pass'
const group = (name) => page.locator('tbody.price-group').filter({ hasText: name })
const rupees = (text) => Number(String(text).replace(/[^\d]/g, ''))

const openPricing = async () => {
  await tab('Settings')
  await page.click('.settings-card:has-text("Pricing manager")')
  await page.waitForSelector('tbody.price-group', { timeout: 10000 })
  await page.waitForTimeout(600)
}

// The "Charging today" line under each product, read back as three numbers.
const chargingToday = async (name) => {
  const text = await group(name).innerText()
  const seg = text.slice(text.indexOf('Charging today'))
  const grab = (label) => {
    const m = seg.match(new RegExp(`${label}\\s*Rs\\.\\s*([\\d,]+)`))
    return m ? rupees(m[1]) : null
  }
  return {
    everyone: grab('Everyone'),
    adult: grab('Adults'),
    child: grab('Children \\(6 and under\\)')
  }
}

const fillRate = async ({ who, days, price, from }) => {
  await page.selectOption('.field:has(label:text-is("Who is this price for?")) select', {
    label: who
  })
  await page.selectOption('.field:has(label:text-is("Which days?")) select', { label: days })
  await page.fill('.field:has(label:text-is("Price")) input', String(price))
  if (from) await page.fill('.field:has(label:text-is("Starts from")) input', from)
  await page.waitForTimeout(300)
}

const addRate = async (name, rate) => {
  await group(name).locator('button:has-text("Add a price")').click()
  await page.waitForTimeout(400)
  await fillRate(rate)
  await page.click('button:has-text("Save this price")')
  await page.waitForTimeout(900)
}

// Reads the seven-day grid: { 'Sat': { everyone, adult, child }, ... }
const readWeek = async (name) => {
  await group(name).locator('button:has-text("Check the week")').click()
  await page.waitForSelector('.price-week table', { timeout: 10000 })
  await page.waitForTimeout(700)
  await page.locator('.price-week').scrollIntoViewIfNeeded()
  const heads = await page.locator('.price-week thead th').allInnerTexts()
  const rows = {
    everyone: 'Everyone',
    adult: 'Adults',
    child: 'Children (6 and under)'
  }
  const grid = {}
  for (const [key, label] of Object.entries(rows)) {
    const cells = await page
      .locator('.price-week tbody tr', { hasText: label })
      .first()
      .locator('td')
      .allInnerTexts()
    heads.forEach((h, i) => {
      if (i === 0) return
      const day = h.trim().slice(0, 3)
      grid[day] = grid[day] || {}
      grid[day][key] = rupees(cells[i])
    })
  }
  return grid
}

const ruleCount = () =>
  page.evaluate(async () => ((await window.api.listPriceRules({})).rules || []).length)

try {
  await completeSetup(page)
  // A fresh database seeds no catalogue at all, so build the little shop first.
  await seedShop(page)
  await openPricing()

  // ---------- Nothing entered means nothing changes ----------
  const introText = await page.locator('.content').innerText()
  check(
    'the screen says that entering nothing keeps today’s prices',
    /standard price/i.test(introText) && /nothing changes/i.test(introText),
    introText.replace(/\n/g, ' ').slice(0, 120)
  )
  const baseline = await chargingToday(PRODUCT)
  check(
    'with no rules every group is charged the standard price',
    baseline.everyone === 300 && baseline.adult === 300 && baseline.child === 300,
    JSON.stringify(baseline)
  )
  await shot(page, 'pricing', '01-empty-price-list')

  // ---------- The owner's actual rates: adults 700, children 500 ----------
  await addRate(PRODUCT, { who: 'Adults', days: 'Every day', price: 700 })
  await addRate(PRODUCT, { who: 'Children (6 and under)', days: 'Every day', price: 500 })

  const listed = await group(PRODUCT).innerText()
  check(
    'both rates are listed in plain words, not tier/day codes',
    /Adults · Every day/.test(listed) &&
      /Children \(6 and under\) · Every day/.test(listed) &&
      !/tier/i.test(listed) &&
      !/dayOfWeek/i.test(listed),
    listed.replace(/\n/g, ' ').slice(0, 140)
  )
  check(
    'the standard price is still shown as the fallback',
    /Standard price/.test(listed) && /Rs\. 300/.test(listed)
  )

  const tiered = await chargingToday(PRODUCT)
  check(
    'the effective price today is right for each group',
    tiered.adult === 700 && tiered.child === 500 && tiered.everyone === 300,
    JSON.stringify(tiered)
  )
  await shot(page, 'pricing', '02-adult-and-child-rates')

  // ---------- Rates survive a sign-out, and are read back from the engine ----
  await tab('Dashboard')
  await logout(page)
  await loginOwner(page)
  await openPricing()
  const afterLogin = await chargingToday(PRODUCT)
  check(
    'the rates are still in force after signing back in',
    afterLogin.adult === 700 && afterLogin.child === 500,
    JSON.stringify(afterLogin)
  )

  // ---------- A negative price is refused before it reaches the handler ------
  const before = await ruleCount()
  await group(PRODUCT).locator('button:has-text("Add a price")').click()
  await page.waitForTimeout(400)
  await fillRate({ who: 'Adults', days: 'Every day', price: -100 })
  await page.click('button:has-text("Save this price")')
  await page.waitForTimeout(600)
  const refusal = await page.locator('.alert.red').first().innerText()
  check(
    'a negative price is refused visibly',
    /less than zero/i.test(refusal) && (await ruleCount()) === before,
    refusal.replace(/\n/g, ' ').slice(0, 80)
  )
  await shot(page, 'pricing', '03-negative-price-refused')
  await page.click('button:has-text("Cancel")')
  await page.waitForTimeout(400)

  // ---------- "500 for everyone on Saturday" — and the honest consequence ----
  await group(PRODUCT).locator('button:has-text("Add a price")').click()
  await page.waitForTimeout(400)
  await fillRate({ who: 'Everyone', days: 'Saturdays', price: 500 })
  await page.locator('.alert.amber').first().scrollIntoViewIfNeeded()
  const warned = await page.locator('.alert.amber').first().innerText()
  check(
    'the shadowing is admitted BEFORE the rule is saved',
    /Adults/.test(warned) &&
      /Children \(6 and under\)/.test(warned) &&
      /beats a rate for a day/i.test(warned) &&
      /Saturdays/.test(warned),
    warned.replace(/\n/g, ' ').slice(0, 160)
  )
  await shot(page, 'pricing', '04-saturday-warning-before-save')
  await page.click('button:has-text("Save this price")')
  await page.waitForTimeout(900)

  const withSaturday = await group(PRODUCT).innerText()
  check(
    'the saved Saturday rate carries the warning in the price list',
    /Everyone · Saturdays/.test(withSaturday) &&
      /Partly overridden/i.test(withSaturday) &&
      /add a Saturdays rate for/i.test(withSaturday),
    withSaturday.replace(/\n/g, ' ').slice(0, 200)
  )

  // The grid is the proof: an adult on Saturday still pays 700.
  const week = await readWeek(PRODUCT)
  check(
    'the week grid shows adults still paying 700 on Saturday',
    week.Sat.adult === 700 && week.Sat.child === 500 && week.Sat.everyone === 500,
    JSON.stringify(week.Sat)
  )
  const weekday = Object.entries(week).find(([d]) => d !== 'Sat')
  check(
    'the week grid shows the every-day rates on the other days',
    weekday[1].adult === 700 && weekday[1].child === 500 && weekday[1].everyone === 300,
    `${weekday[0]} ${JSON.stringify(weekday[1])}`
  )
  await shot(page, 'pricing', '05-week-grid-shadowed')

  // ---------- Doing what the screen suggests actually fixes it --------------
  await page.click('.price-week button:has-text("Close")')
  await page.waitForTimeout(300)
  await addRate(PRODUCT, { who: 'Adults', days: 'Saturdays', price: 500 })
  const fixedWeek = await readWeek(PRODUCT)
  check(
    'adding a Saturday rate for Adults drops them to 500 on Saturday only',
    fixedWeek.Sat.adult === 500 &&
      Object.entries(fixedWeek).filter(([d]) => d !== 'Sat')[0][1].adult === 700,
    JSON.stringify(fixedWeek.Sat)
  )
  await page.click('.price-week button:has-text("Close")')
  await page.waitForTimeout(300)
  const overridden = await group(PRODUCT).innerText()
  check(
    'the every-day adult rate now admits it is overridden on Saturdays',
    /Partly overridden/.test(overridden) && /Adults on Saturdays/.test(overridden),
    overridden.replace(/\n/g, ' ').slice(0, 200)
  )
  await shot(page, 'pricing', '06-saturday-fixed')

  // ---------- Removing a rate falls back to the next most specific ----------
  // On a Saturday the untiered Saturday rate catches children; any other day
  // there is nothing left but the standard price. Both are "the next one down".
  const isSaturday = new Date().getDay() === 6
  const expectedFallback = isSaturday ? 500 : 300
  await group(PRODUCT)
    .locator('tr.price-rule', { hasText: 'Children (6 and under) · Every day' })
    .locator('button:has-text("Remove")')
    .click()
  await page.waitForTimeout(500)
  const removeCard = page.locator('.card', { hasText: 'Remove the Children' })
  await removeCard.scrollIntoViewIfNeeded()
  const confirmText = await removeCard.innerText()
  check(
    'removing a rate says in rupees what will be charged instead',
    new RegExp(`Rs\\. ${expectedFallback}`).test(confirmText) &&
      /Children \(6 and under\) will then pay/.test(confirmText),
    confirmText.replace(/\n/g, ' ').slice(0, 140)
  )
  await shot(page, 'pricing', '07-remove-confirm')
  await page.click('button:has-text("Yes, remove it")')
  await page.waitForTimeout(1000)

  const afterRemoval = await chargingToday(PRODUCT)
  check(
    'the child rate is gone and the next most specific rate applies',
    afterRemoval.child === expectedFallback && afterRemoval.adult === (isSaturday ? 500 : 700),
    JSON.stringify(afterRemoval)
  )
  check(
    'the removed rate is no longer listed',
    !/Children \(6 and under\) · Every day/.test(await group(PRODUCT).innerText())
  )

  // ---------- The flat price and its history still work ---------------------
  await group(PRODUCT).locator('button:has-text("Edit")').click()
  await page.waitForTimeout(300)
  await group(PRODUCT).locator('input[type="number"]').fill('350')
  await group(PRODUCT).locator('button:has-text("Save")').click()
  await page.waitForTimeout(900)
  check(
    'the standard price can still be edited',
    /Standard price[\s\S]*Rs\. 350/.test(await group(PRODUCT).innerText()),
    (await group(PRODUCT).innerText()).replace(/\n/g, ' ').slice(0, 90)
  )
  await group(PRODUCT).locator('button:has-text("History")').click()
  await page.waitForTimeout(700)
  const historyText = await page.locator('.card', { hasText: 'Price history' }).innerText()
  check(
    'the price history view still works',
    /Rs\. 300/.test(historyText) && /Rs\. 350/.test(historyText),
    historyText.replace(/\n/g, ' ').slice(0, 90)
  )
  await shot(page, 'pricing', '08-standard-price-and-history')

  console.log('\nconsole errors:', errors.length ? errors : 'none')
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
} finally {
  await app.close()
  cleanup()
}
