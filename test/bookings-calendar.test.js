import { describe, it, expect, beforeEach } from 'vitest'
import { __invoke } from 'electron'
import { freshDb, seed, loginOwner } from './helpers.js'
import { expandSeriesDates } from '../src/main/ipc/bookings.js'
import { monthCells, previewSeriesDates } from '../src/renderer/src/screens/owner-bookings.jsx'

let db
let ids

beforeEach(() => {
  db = freshDb()
  ids = seed(db)
  loginOwner(ids)
})

function rowsNamed(name) {
  return db
    .prepare(`SELECT * FROM bookings WHERE booking_name = ? ORDER BY booking_date, id`)
    .all(name)
}

// The owner's words: "let's make this like optional — I should be able to save
// it even without putting in anything."
describe('deposit and total are genuinely optional', () => {
  it('saves with both fields left completely blank', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Shree Secondary School',
      bookingDate: '2026-03-24',
      timeSlot: '11am-12pm',
      depositPaid: '',
      totalExpected: '',
      depositMethod: ''
    })
    expect(r.success).toBe(true)
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(r.bookingId)
    expect(row.deposit_paid).toBe(0)
    expect(row.total_expected).toBe(0)
    expect(row.deposit_method).toBe(null)
    // No money was implied, so no money transaction was written.
    expect(row.deposit_transaction_id).toBe(null)
    expect(db.prepare(`SELECT COUNT(*) c FROM transactions`).get().c).toBe(0)
  })

  it('saves when the fields are omitted from the payload entirely', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'No money school',
      bookingDate: '2026-03-25'
    })
    expect(r.success).toBe(true)
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(r.bookingId)
    expect(row.deposit_paid).toBe(0)
    expect(row.total_expected).toBe(0)
  })

  it('a non-zero deposit still writes its linked money transaction', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Paying school',
      bookingDate: '2026-03-26',
      depositPaid: 2500,
      depositMethod: 'cash'
    })
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(r.bookingId)
    expect(row.deposit_transaction_id).not.toBe(null)
    const txn = db
      .prepare('SELECT * FROM transactions WHERE id = ?')
      .get(row.deposit_transaction_id)
    expect(txn.amount).toBe(2500)
    expect(txn.transaction_type).toBe('booking_deposit')
  })
})

// Two schools on the same Tuesday, 11-12 and 1-2. Sorted as text "1pm" beats
// "9am", so a day's running order has to come from a parsed start time.
describe('a single day reads in true time order', () => {
  const day = '2026-03-24'

  beforeEach(async () => {
    // Deliberately inserted out of order.
    await __invoke('bookings:create', {
      bookingName: 'Himalaya School',
      bookingDate: day,
      timeSlot: '1pm-2pm',
      numPeople: 30
    })
    await __invoke('bookings:create', {
      bookingName: 'Early swim club',
      bookingDate: day,
      timeSlot: '9am-10am',
      numPeople: 8
    })
    await __invoke('bookings:create', {
      bookingName: 'Shree Secondary School',
      bookingDate: day,
      timeSlot: '11am-12pm',
      numPeople: 40
    })
  })

  it('returns that day in start-time order, each slot distinguishable', async () => {
    const { bookings } = await __invoke('bookings:list', { dateFrom: day, dateTo: day })
    expect(bookings.map((b) => b.bookingName)).toEqual([
      'Early swim club',
      'Shree Secondary School',
      'Himalaya School'
    ])
    expect(bookings.map((b) => b.timeSlot)).toEqual(['9am-10am', '11am-12pm', '1pm-2pm'])
    expect(bookings.map((b) => b.startMinutes)).toEqual([9 * 60, 11 * 60, 13 * 60])
    // Distinct rows, so the day view can key and act on each one separately.
    expect(new Set(bookings.map((b) => b.id)).size).toBe(3)
  })

  it('a slot with no readable time sorts to the end of its day, not to midnight', async () => {
    await __invoke('bookings:create', {
      bookingName: 'Time TBC',
      bookingDate: day,
      timeSlot: 'afternoon, to confirm'
    })
    const { bookings } = await __invoke('bookings:list', { dateFrom: day, dateTo: day })
    expect(bookings[bookings.length - 1].bookingName).toBe('Time TBC')
    expect(bookings[bookings.length - 1].startMinutes).toBe(null)
  })
})

describe('weekly recurrence generates one real booking per occurrence', () => {
  it('every Tue and Thu across a month boundary hits exactly the right dates', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Shree Secondary School',
      bookingDate: '2026-03-24', // a Tuesday
      timeSlot: '11am-12pm',
      numPeople: 40,
      repeat: { weekdays: [2, 4], until: '2026-04-16' }
    })
    expect(r.success).toBe(true)
    expect(r.count).toBe(8)
    expect(r.dates).toEqual([
      '2026-03-24',
      '2026-03-26',
      '2026-03-31',
      '2026-04-02',
      '2026-04-07',
      '2026-04-09',
      '2026-04-14',
      '2026-04-16'
    ])
    const rows = rowsNamed('Shree Secondary School')
    expect(rows.map((b) => b.booking_date)).toEqual(r.dates)
    // Independent rows, each carrying the full booking detail.
    expect(rows.every((b) => b.time_slot === '11am-12pm' && b.num_people === 40)).toBe(true)
    expect(new Set(rows.map((b) => b.id)).size).toBe(8)
  })

  it('a second school can take the same days at a different time', async () => {
    await __invoke('bookings:create', {
      bookingName: 'School A',
      bookingDate: '2026-03-24',
      timeSlot: '11am-12pm',
      repeat: { weekdays: [2, 4], until: '2026-03-31' }
    })
    await __invoke('bookings:create', {
      bookingName: 'School B',
      bookingDate: '2026-03-24',
      timeSlot: '1pm-2pm',
      repeat: { weekdays: [2, 4], until: '2026-03-31' }
    })
    const { bookings } = await __invoke('bookings:list', {
      dateFrom: '2026-03-24',
      dateTo: '2026-03-24'
    })
    expect(bookings.map((b) => [b.bookingName, b.timeSlot])).toEqual([
      ['School A', '11am-12pm'],
      ['School B', '1pm-2pm']
    ])
  })

  it('charges the deposit once for the series, not once per occurrence', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Deposit school',
      bookingDate: '2026-03-24',
      repeat: { weekdays: [2, 4], until: '2026-04-16' },
      depositPaid: 5000,
      depositMethod: 'cash'
    })
    expect(r.count).toBe(8)
    const txns = db
      .prepare(`SELECT * FROM transactions WHERE transaction_type = 'booking_deposit'`)
      .all()
    expect(txns.length).toBe(1)
    expect(txns[0].amount).toBe(5000)
    const rows = rowsNamed('Deposit school')
    expect(rows[0].deposit_paid).toBe(5000)
    expect(rows.slice(1).every((b) => b.deposit_paid === 0)).toBe(true)
  })

  it('rejects a repeat with no weekdays chosen and an end date before the start', async () => {
    // Asking to repeat but naming no day is a mistake, not a request for one
    // booking — say so rather than quietly saving something else.
    const noDays = await __invoke('bookings:create', {
      bookingName: 'Bad series',
      bookingDate: '2026-03-24',
      repeat: { weekdays: [], until: '2026-04-16' }
    })
    expect(noDays.success).toBe(false)
    expect(rowsNamed('Bad series').length).toBe(0)

    const backwards = await __invoke('bookings:create', {
      bookingName: 'Backwards series',
      bookingDate: '2026-03-24',
      repeat: { weekdays: [2], until: '2026-03-01' }
    })
    expect(backwards.success).toBe(false)
    expect(rowsNamed('Backwards series').length).toBe(0)
  })
})

describe('the occurrence cap stops a mistyped end date', () => {
  it('refuses a series over 200 occurrences and writes nothing', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Runaway',
      bookingDate: '2026-01-05',
      repeat: { weekdays: [1, 2, 3, 4, 5], until: '2026-12-31' } // ~260 weekdays
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/200/)
    expect(rowsNamed('Runaway').length).toBe(0)
  })

  it('allows a series of exactly 200', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Right at the cap',
      bookingDate: '2026-01-06', // a Tuesday
      repeat: { weekdays: [2], until: '2029-10-30' } // the 200th Tuesday
    })
    expect(r.success).toBe(true)
    expect(r.count).toBe(200)
    expect(rowsNamed('Right at the cap').length).toBe(200)
  })
})

describe('a series is all-or-nothing', () => {
  it('a failure partway through creates no bookings and no deposit', async () => {
    // Force the 4th occurrence to fail at the database, the way a constraint
    // violation mid-series would.
    db.exec(`
      CREATE TRIGGER t_fail_one_occurrence BEFORE INSERT ON bookings
      WHEN NEW.booking_date = '2026-04-02'
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `)
    const r = await __invoke('bookings:create', {
      bookingName: 'Half a term',
      bookingDate: '2026-03-24',
      repeat: { weekdays: [2, 4], until: '2026-04-16' },
      depositPaid: 5000,
      depositMethod: 'cash'
    })
    db.exec('DROP TRIGGER t_fail_one_occurrence')

    expect(r.success).toBe(false)
    expect(rowsNamed('Half a term').length).toBe(0)
    // The first occurrence's deposit transaction rolled back with it.
    expect(db.prepare(`SELECT COUNT(*) c FROM transactions`).get().c).toBe(0)
  })
})

describe('occurrences are independent rows', () => {
  it('cancelling one occurrence leaves the rest live', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Shree Secondary School',
      bookingDate: '2026-03-24',
      timeSlot: '11am-12pm',
      repeat: { weekdays: [2, 4], until: '2026-04-16' }
    })
    expect(r.count).toBe(8)
    const cancelled = r.bookingIds[3] // 2026-04-02

    const res = await __invoke('bookings:update-status', {
      bookingId: cancelled,
      status: 'cancelled'
    })
    expect(res.success).toBe(true)
    // Contract kept: cancel reports the deposit still on the books (none here).
    expect(res.outstandingDeposit).toBe(0)

    const rows = rowsNamed('Shree Secondary School')
    expect(rows.filter((b) => b.status === 'cancelled').map((b) => b.booking_date)).toEqual([
      '2026-04-02'
    ])
    expect(rows.filter((b) => b.status !== 'cancelled').length).toBe(7)
  })

  it('a cancelled occurrence still comes back from the month query, flagged', async () => {
    const r = await __invoke('bookings:create', {
      bookingName: 'Shree Secondary School',
      bookingDate: '2026-04-02',
      timeSlot: '11am-12pm'
    })
    await __invoke('bookings:update-status', { bookingId: r.bookingId, status: 'cancelled' })
    const { bookings } = await __invoke('bookings:list', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30'
    })
    expect(bookings.length).toBe(1)
    expect(bookings[0].status).toBe('cancelled')
  })
})

describe('the month query returns only that month', () => {
  it('excludes the months either side', async () => {
    for (const date of ['2026-02-26', '2026-03-01', '2026-03-15', '2026-03-31', '2026-04-01']) {
      await __invoke('bookings:create', { bookingName: `B ${date}`, bookingDate: date })
    }
    const { bookings } = await __invoke('bookings:list', {
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31'
    })
    expect(bookings.map((b) => b.bookingDate)).toEqual(['2026-03-01', '2026-03-15', '2026-03-31'])
    // Every row carries what a calendar cell needs to render.
    expect(bookings.every((b) => b.dateDisplay && b.status && b.id)).toBe(true)
  })
})

// The form promises "this will create N bookings" before the click, so its
// count has to be the same count the handler will actually write.
describe('the calendar UI date maths agrees with the handler', () => {
  it('the form preview matches the dates the handler generates', () => {
    const preview = previewSeriesDates('2026-03-24', [2, 4], '2026-04-16')
    expect(preview.overCap).toBe(false)
    expect(preview.dates).toEqual(expandSeriesDates('2026-03-24', [2, 4], '2026-04-16'))
    expect(preview.dates.length).toBe(8)
  })

  it('the form flags an over-cap series instead of promising it', () => {
    const preview = previewSeriesDates('2026-01-05', [1, 2, 3, 4, 5], '2026-12-31')
    expect(preview.overCap).toBe(true)
    expect(() => expandSeriesDates('2026-01-05', [1, 2, 3, 4, 5], '2026-12-31')).toThrow(/200/)
  })

  it('a backwards range is caught before it is sent', () => {
    expect(previewSeriesDates('2026-03-24', [2], '2026-03-01').backwards).toBe(true)
  })

  it('lays every date of a month under its real weekday', () => {
    const cells = monthCells('2026-03')
    expect(cells.length % 7).toBe(0)
    // 1 Mar 2026 is a Sunday, so it is the very first cell with no lead blanks.
    expect(cells[0]).toBe('2026-03-01')
    expect(cells.filter(Boolean).length).toBe(31)
    expect(cells.filter(Boolean).at(-1)).toBe('2026-03-31')
    // Every Tuesday of the series must sit in the Tuesday column (index 2).
    for (const date of ['2026-03-24', '2026-03-31']) {
      expect(cells.indexOf(date) % 7).toBe(2)
    }
  })

  it('places a month that does not start on Sunday behind the right lead blanks', () => {
    const cells = monthCells('2026-04') // 1 Apr 2026 is a Wednesday
    expect(cells.slice(0, 3)).toEqual([null, null, null])
    expect(cells[3]).toBe('2026-04-01')
    expect(cells.indexOf('2026-04-02') % 7).toBe(4) // Thursday column
  })
})
