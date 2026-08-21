// Shared helpers for the "month of history" demo dataset — used by the seed
// script (runs inside Electron via Playwright) and the backdate script (runs
// under `ELECTRON_RUN_AS_NODE=1 electron`, plain Node, no Electron/Playwright
// APIs). Keep this file free of both kinds of imports so either can load it.
import { join } from 'path'
import { tmpdir } from 'os'

// A fixed (non-random) path so the seed, backdate and tour scripts all agree
// on which on-disk profile they're working with across three separate
// process launches.
export const DEMO_DIR = join(tmpdir(), 'refresh-manager-demo-userdata')

const MALE_NAMES = [
  'Sambhav Lamichhane',
  'Rajesh Shrestha',
  'Bikash Tamang',
  'Sujan Gurung',
  'Prakash Rai',
  'Nabin Thapa',
  'Sandip Karki',
  'Bishal Magar',
  'Arjun Basnet',
  'Rohit Poudel',
  'Sagar Adhikari',
  'Dipesh Maharjan',
  'Kiran Bhattarai',
  'Ashish Khadka',
  'Yogesh Bista'
]

const FEMALE_NAMES = [
  'Anita Shrestha',
  'Sabina Gurung',
  'Priya Tamang',
  'Sunita Rai',
  'Kritika Basnet',
  'Manisha Karki',
  'Rekha Adhikari',
  'Nisha Maharjan',
  'Puja Bhattarai',
  'Sarita Khadka',
  'Sneha Poudel',
  'Bandana Thapa',
  'Rachana Magar',
  'Sabnam Lama',
  'Grishma Bista'
]

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function randFloat(min, max) {
  return Math.random() * (max - min) + min
}

export function pick(arr) {
  return arr[randInt(0, arr.length - 1)]
}

// One list of {name, gender, phone}, each used at most once, so the member
// roster doesn't repeat a name — a phone book of a plausible size for a
// neighbourhood pool/gym.
export function buildPeople(count) {
  const pool = [
    ...MALE_NAMES.map((name) => ({ name, gender: 'male' })),
    ...FEMALE_NAMES.map((name) => ({ name, gender: 'female' }))
  ]
  const people = []
  let phoneSeq = 9800000010
  for (let i = 0; i < count; i++) {
    const base = pool[i % pool.length]
    // Once the base list is exhausted, distinguish repeats with a middle
    // initial rather than silently duplicating a customer.
    const suffix = i >= pool.length ? ` ${String.fromCharCode(65 + Math.floor(i / pool.length))}.` : ''
    people.push({
      name: suffix ? base.name.replace(' ', suffix + ' ') : base.name,
      gender: base.gender,
      phone: String(phoneSeq++)
    })
  }
  return people
}

export function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fmtDateTime(d) {
  const date = fmtDate(d)
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${date} ${h}:${min}:${s}`
}

export function daysAgo(n, hour = null, minute = null) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour ?? randInt(8, 20), minute ?? randInt(0, 59), randInt(0, 59), 0)
  return d
}

export function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// count timestamps spread over the last `days` days (day 0 = today), business
// hours only, weighted so Friday/Saturday (the Nepali weekend rush) get more
// than a plain uniform share, returned ascending as 'YYYY-MM-DD HH:MM:SS'.
export function spreadPastDateTimes(count, { days = 30 } = {}) {
  const weights = []
  for (let offset = 0; offset < days; offset++) {
    const dow = daysAgo(offset).getDay() // 0 Sun .. 6 Sat
    let w = 1
    if (dow === 6) w = 3 // Saturday — the big rush day
    else if (dow === 5) w = 1.6 // Friday evening
    weights.push(w)
  }
  const total = weights.reduce((a, b) => a + b, 0)
  const cumulative = []
  let running = 0
  for (const w of weights) {
    running += w
    cumulative.push(running)
  }

  const offsets = []
  for (let i = 0; i < count; i++) {
    const r = Math.random() * total
    const offset = cumulative.findIndex((c) => r <= c)
    offsets.push(offset === -1 ? 0 : offset)
  }
  // A handful of the most recent entries are forced onto "today" so Today's
  // Log / End of Day have something to show when the tour walks the staff
  // screens.
  for (let i = 0; i < Math.min(6, offsets.length); i++) {
    offsets[randInt(0, offsets.length - 1)] = 0
  }

  const dts = offsets.map((offset) => daysAgo(offset))
  dts.sort((a, b) => a - b)
  return dts.map(fmtDateTime)
}
