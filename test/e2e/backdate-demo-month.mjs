// Phase 2 of 3 for the "month of history" demo dataset.
//
// Every row seed-demo-month.mjs created was necessarily timestamped "now" by
// the server (sales:create etc. always use the server clock, never a payload
// date) — this script is what actually spreads that single burst of activity
// across the past ~30 days, so Reports/Dashboard/Today's Log read like an
// operating business instead of five minutes of test traffic.
//
// Membership dates are the one exception: seed-demo-month.mjs already set
// real start_date values through the API's own startDate/newStartDate params,
// so here we just make each membership's SIGNUP TRANSACTION and the MEMBER'S
// join date agree with that already-correct start_date, rather than
// re-deriving anything.
//
// Must run with better-sqlite3 built for Electron's Node ABI, so this has to
// execute inside an Electron process — but as plain Node, not the app. That's
// what ELECTRON_RUN_AS_NODE does: it runs this file under Electron's Node
// runtime without booting the app or opening a window.
//
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron test/e2e/backdate-demo-month.mjs
import Database from 'better-sqlite3'
import { join } from 'path'
import { DEMO_DIR, spreadPastDateTimes, randInt, fmtDateTime, fmtDate } from './demo-data.mjs'

const dbPath = join(DEMO_DIR, 'refresh.db')
console.log('Opening', dbPath)
const db = new Database(dbPath)
db.pragma('foreign_keys = OFF') // bulk timestamp rewrites, not structural edits

function dateTimeFromDay(dayStr) {
  const d = new Date(dayStr + 'T00:00:00')
  d.setHours(randInt(8, 20), randInt(0, 59), randInt(0, 59), 0)
  return fmtDateTime(d)
}

const run = db.transaction(() => {
  // ---- 1. Ordinary sales (day passes, packages, pool/restaurant items) ----
  // Booking deposits are excluded here — they get the booking's own date in
  // step 4, so a deposit reads as "paid when the booking was made."
  const saleIds = db
    .prepare(
      `SELECT id FROM transactions
       WHERE transaction_type NOT IN ('membership', 'booking_deposit')
       ORDER BY id ASC`
    )
    .all()
    .map((r) => r.id)
  const saleSchedule = spreadPastDateTimes(saleIds.length, { days: 30 })

  const updTxn = db.prepare('UPDATE transactions SET created_at = ? WHERE id = ?')
  const updLines = db.prepare('UPDATE transaction_lines SET created_at = ? WHERE transaction_id = ?')
  const updPayments = db.prepare(
    'UPDATE transaction_payments SET paid_at = ? WHERE transaction_id = ?'
  )
  const updPoolMove = db.prepare(
    'UPDATE pool_inventory_transactions SET created_at = ? WHERE transaction_id = ?'
  )
  const updRestMove = db.prepare(
    'UPDATE restaurant_inventory_transactions SET created_at = ? WHERE transaction_id = ?'
  )

  saleIds.forEach((id, i) => {
    const dt = saleSchedule[i]
    updTxn.run(dt, id)
    updLines.run(dt, id)
    updPayments.run(dt, id)
    updPoolMove.run(dt, id)
    updRestMove.run(dt, id)
  })
  console.log(`Backdated ${saleIds.length} sale transactions across the past 30 days.`)

  // ---- 2. Membership transactions (signups + renewals) ----
  // Dated from the membership's own start_date, which seed-demo-month.mjs
  // already set for real via the API — not re-derived here.
  const memberships = db
    .prepare(`SELECT id, member_id, transaction_id, start_date FROM memberships ORDER BY id ASC`)
    .all()

  const earliestByMember = new Map()
  for (const m of memberships) {
    const dt = dateTimeFromDay(m.start_date)
    if (m.transaction_id) {
      updTxn.run(dt, m.transaction_id)
      updLines.run(dt, m.transaction_id)
      updPayments.run(dt, m.transaction_id)
    }
    const prevBest = earliestByMember.get(m.member_id)
    if (!prevBest || m.start_date < prevBest) earliestByMember.set(m.member_id, m.start_date)
  }
  console.log(`Backdated ${memberships.length} membership transactions to their real start dates.`)

  // ---- 3. Member "joined" date follows their earliest membership ----
  const updMember = db.prepare('UPDATE members SET created_at = ? WHERE id = ?')
  for (const [memberId, joinDate] of earliestByMember) {
    updMember.run(dateTimeFromDay(joinDate), memberId)
  }
  console.log(`Backdated ${earliestByMember.size} member join dates.`)

  // ---- 4. Bookings: created a few days ahead of the event itself ----
  db.exec(
    `UPDATE bookings SET created_at = datetime(booking_date, '-' || (2 + (abs(random()) % 5)) || ' days')`
  )
  db.exec(
    `UPDATE transactions SET created_at = (
       SELECT b.created_at FROM bookings b WHERE b.deposit_transaction_id = transactions.id
     )
     WHERE id IN (SELECT deposit_transaction_id FROM bookings WHERE deposit_transaction_id IS NOT NULL)`
  )
  const bookingCount = db.prepare('SELECT COUNT(*) AS c FROM bookings').get().c
  console.log(`Backdated ${bookingCount} bookings' created_at to a few days before their event.`)

  // ---- 5. Restock-only inventory movements (no linked sale) ----
  for (const table of ['pool_inventory_transactions', 'restaurant_inventory_transactions']) {
    const ids = db
      .prepare(`SELECT id FROM ${table} WHERE transaction_id IS NULL ORDER BY id ASC`)
      .all()
      .map((r) => r.id)
    const schedule = spreadPastDateTimes(ids.length, { days: 30 })
    const upd = db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`)
    ids.forEach((id, i) => upd.run(schedule[i], id))
    console.log(`Backdated ${ids.length} restock rows in ${table}.`)
  }

  // ---- 6. Check-ins: spread the seeded ones, then add repeat-visit volume ----
  const checkinIds = db.prepare('SELECT id FROM check_ins ORDER BY id ASC').all().map((r) => r.id)
  const checkinSchedule = spreadPastDateTimes(checkinIds.length, { days: 30 })
  const updCheckin = db.prepare('UPDATE check_ins SET checked_in_at = ? WHERE id = ?')
  checkinIds.forEach((id, i) => updCheckin.run(checkinSchedule[i], id))

  const memberIds = db.prepare('SELECT id FROM members').all().map((r) => r.id)
  const staffIds = db.prepare("SELECT id FROM users WHERE is_active = 1").all().map((r) => r.id)
  const insertCheckin = db.prepare(
    'INSERT INTO check_ins (member_id, checked_in_at, staff_id, source) VALUES (?, ?, ?, ?)'
  )
  const seen = new Set(
    db
      .prepare(`SELECT member_id, date(checked_in_at) AS day FROM check_ins`)
      .all()
      .map((r) => `${r.member_id}:${r.day}`)
  )
  let extraCheckins = 0
  let attempts = 0
  while (extraCheckins < 90 && attempts < 600) {
    attempts++
    const memberId = memberIds[randInt(0, memberIds.length - 1)]
    const dayOffset = randInt(0, 29)
    const d = new Date()
    d.setDate(d.getDate() - dayOffset)
    // date(checked_in_at) compares the LOCAL calendar day encoded in the
    // 'YYYY-MM-DD HH:MM:SS' string we write, never a UTC one — so the dedup
    // key has to be built from local date parts (fmtDate), not toISOString().
    const day = fmtDate(d)
    const key = `${memberId}:${day}`
    if (seen.has(key)) continue
    seen.add(key)
    d.setHours(randInt(8, 20), randInt(0, 59), randInt(0, 59), 0)
    const dt = fmtDateTime(d)
    const staffId = staffIds.length ? staffIds[randInt(0, staffIds.length - 1)] : null
    insertCheckin.run(memberId, dt, staffId, 'member')
    extraCheckins++
  }
  console.log(
    `Backdated ${checkinIds.length} check-ins and added ${extraCheckins} repeat-visit check-ins.`
  )

  // ---- 7. Price history ----
  const priceRows = db.prepare('SELECT id FROM price_history ORDER BY id ASC').all().map((r) => r.id)
  const priceSchedule = spreadPastDateTimes(priceRows.length, { days: 30 })
  const updPrice = db.prepare('UPDATE price_history SET changed_at = ? WHERE id = ?')
  priceRows.forEach((id, i) => updPrice.run(priceSchedule[i], id))
  console.log(`Backdated ${priceRows.length} price history rows.`)
})

run()
db.close()
console.log('\nBackdate pass complete.')
