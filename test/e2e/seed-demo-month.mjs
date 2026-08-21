// Phase 1 of 3 for the "month of history" demo dataset.
//
// Boots a fresh app profile at DEMO_DIR, completes setup, and builds a full
// catalogue + a busy roster of members, sales, bookings, inventory movement
// and EOD closes. Everything here is created through the same window.api the
// real UI uses, so business rules (stock draw-down, pricing, membership
// math) run exactly as they would for a real shop — the only thing this
// script controls that a real shop wouldn't is WHEN, and even membership
// start dates are set for real via the API's own startDate/newStartDate
// params, not backdated after the fact.
//
// Everything that truly can't be dated at creation time (a sale is always
// timestamped "now" by the server) is spread across the past by
// backdate-demo-month.mjs (phase 2), which must run against a fully closed
// app — hence this script closes rather than cleans up its userDataDir.
//
// Run: node test/e2e/seed-demo-month.mjs
import { mkdirSync, rmSync } from 'fs'
import { launchApp, OWNER, STAFF } from './harness.mjs'
import { DEMO_DIR, buildPeople } from './demo-data.mjs'

rmSync(DEMO_DIR, { recursive: true, force: true })
mkdirSync(DEMO_DIR, { recursive: true })

const { app, page, errors } = await launchApp({ area: 'demo-seed', keepData: DEMO_DIR })

try {
  console.log('Completing setup...')
  await page.waitForSelector('text=Welcome to Refresh Manager', { timeout: 20000 })
  const setupInputs = page.locator('.card input')
  await setupInputs.nth(0).fill(OWNER.name)
  await setupInputs.nth(1).fill(OWNER.password)
  await setupInputs.nth(2).fill(OWNER.password)
  await setupInputs.nth(3).fill(STAFF.name)
  await setupInputs.nth(4).fill(STAFF.pin)
  await page.click('button:has-text("Complete setup")')
  await page.waitForSelector('.sidebar', { timeout: 20000 })

  // Two more staff so Staff PINs / Staff Activity aren't a roster of one.
  await page.evaluate(async () => {
    await window.api.addStaff({ name: 'Priya Karki', pin: '1111' })
    await window.api.addStaff({ name: 'Kiran Basnet', pin: '2222' })
  })

  console.log('Building catalogue...')
  const catalog = await page.evaluate(async () => {
    const dayPass = await window.api.addProduct({
      name: 'Pool Day Pass',
      category: 'day_pass',
      price: 300
    })
    const dayPackage = await window.api.addProduct({
      name: 'Family Day Package',
      category: 'day_package',
      price: 1200
    })
    const monthlyGym = await window.api.addProduct({
      name: 'Gym Only Monthly',
      category: 'membership',
      durationDays: 30,
      price: 2500
    })
    const monthlySwim = await window.api.addProduct({
      name: 'Swimming Monthly',
      category: 'membership',
      durationDays: 30,
      price: 3000
    })
    const quarterly = await window.api.addProduct({
      name: 'Swim + Gym Quarterly',
      category: 'membership',
      durationDays: 90,
      price: 8000
    })
    const annual = await window.api.addProduct({
      name: 'Annual All-Access',
      category: 'membership',
      durationDays: 365,
      price: 25000
    })

    const poolSpecs = [
      { name: 'Goggles', variant: 'Adult', reorderLevel: 5, sellingPrice: 250, restock: 30 },
      { name: 'Goggles', variant: 'Kids', reorderLevel: 5, sellingPrice: 200, restock: 20 },
      { name: 'Swim Cap', variant: 'Adult', reorderLevel: 10, sellingPrice: 150, restock: 25 },
      { name: 'Floaties', variant: 'Kids', reorderLevel: 5, sellingPrice: 300, restock: 12 },
      { name: 'Nose Clip', variant: null, reorderLevel: 10, sellingPrice: 100, restock: 15 }
    ]
    const poolItems = []
    for (const spec of poolSpecs) {
      const item = await window.api.addPoolItem({
        name: spec.name,
        category: 'gear',
        variant: spec.variant,
        reorderLevel: spec.reorderLevel,
        sellingPrice: spec.sellingPrice
      })
      await window.api.restockPoolItem({ itemId: item.itemId, quantity: spec.restock })
      poolItems.push({ id: item.itemId, name: spec.name })
    }

    const menuSpecs = [
      { name: 'Tea leaves', unit: 'kg', reorder: 3, restock: 10, menu: 'Tea', price: 50 },
      { name: 'Coffee powder', unit: 'kg', reorder: 2, restock: 5, menu: 'Coffee', price: 80 },
      { name: 'Water Bottles', unit: 'pcs', reorder: 12, restock: 60, menu: 'Water Bottle', price: 40 },
      { name: 'Momo Packs', unit: 'pcs', reorder: 8, restock: 40, menu: 'Veg Momo', price: 180 },
      { name: 'Noodles Packs', unit: 'pcs', reorder: 6, restock: 30, menu: 'Chowmein', price: 150 },
      { name: 'Biscuit Packs', unit: 'pcs', reorder: 10, restock: 50, menu: 'Biscuit Pack', price: 30 }
    ]
    const menuItems = []
    for (const spec of menuSpecs) {
      const inv = await window.api.addRestaurantItem({
        name: spec.name,
        category: 'bev',
        unit: spec.unit,
        reorderLevel: spec.reorder
      })
      await window.api.restockRestaurantItem({ itemId: inv.itemId, quantity: spec.restock })
      const menu = await window.api.addMenuItem({
        name: spec.menu,
        category: 'bev',
        price: spec.price,
        inventoryItemId: inv.itemId
      })
      menuItems.push({ id: menu.id, invId: inv.itemId, name: spec.menu })
    }

    // Mid-month top-up restock for most items — Floaties, Nose Clip, Momo and
    // Noodles are deliberately left un-topped-up so their stock runs low
    // after a month of sales (the low-stock screens need something to show).
    await window.api.restockPoolItem({ itemId: poolItems[0].id, quantity: 15 }) // Goggles Adult
    await window.api.restockPoolItem({ itemId: poolItems[1].id, quantity: 10 }) // Goggles Kids
    await window.api.restockPoolItem({ itemId: poolItems[2].id, quantity: 10 }) // Swim Cap
    await window.api.restockRestaurantItem({ itemId: menuItems[0].invId, quantity: 8 }) // Tea
    await window.api.restockRestaurantItem({ itemId: menuItems[1].invId, quantity: 4 }) // Coffee
    await window.api.restockRestaurantItem({ itemId: menuItems[2].invId, quantity: 30 }) // Water

    // Two price changes so Pricing manager has real history to show.
    await window.api.updatePrice({ productId: dayPass.productId, newPrice: 350 })
    await window.api.updatePrice({ productId: monthlyGym.productId, newPrice: 2800 })

    return {
      dayPassId: dayPass.productId,
      dayPackageId: dayPackage.productId,
      monthlyGymId: monthlyGym.productId,
      monthlySwimId: monthlySwim.productId,
      quarterlyId: quarterly.productId,
      annualId: annual.productId,
      poolItems,
      menuItems
    }
  })
  console.log('Catalogue ready:', JSON.stringify(catalog).slice(0, 200), '...')

  console.log('Creating members with a realistic mix of active/expiring/lapsed memberships...')
  const people = buildPeople(22)
  const membershipProducts = [
    catalog.monthlyGymId,
    catalog.monthlySwimId,
    catalog.quarterlyId,
    catalog.annualId
  ]
  const durationByProduct = {
    [catalog.monthlyGymId]: 30,
    [catalog.monthlySwimId]: 30,
    [catalog.quarterlyId]: 90,
    [catalog.annualId]: 365
  }

  const members = await page.evaluate(
    async ({ people, membershipProducts, durationByProduct }) => {
      function addDaysISO(offset) {
        const d = new Date()
        d.setDate(d.getDate() + offset)
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
      }
      function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min
      }

      const results = []
      for (let i = 0; i < people.length; i++) {
        const p = people[i]
        const productId = membershipProducts[i % membershipProducts.length]
        const duration = durationByProduct[productId]

        let remainingDays
        if (duration >= 365) {
          remainingDays = null // handled via startOffset below
        } else {
          const roll = Math.random()
          if (roll < 0.45) remainingDays = randInt(10, 29) // healthy active
          else if (roll < 0.7) remainingDays = randInt(0, 4) // expiring soon
          else remainingDays = -randInt(2, 10) // lapsed
        }

        let startOffset
        if (duration >= 365 || duration >= 90) {
          startOffset = -randInt(3, 45) // recent join, plenty of runway left
        } else {
          startOffset = remainingDays - (duration - 1)
        }

        const startDate = addDaysISO(startOffset)
        const paymentMethod = i % 4 === 0 ? 'qr' : 'cash'

        const created = await window.api.createMemberWithMembership({
          name: p.name,
          phone: p.phone,
          gender: p.gender,
          productId,
          startDate,
          paymentMethod
        })
        results.push({
          memberId: created.memberId,
          membershipId: created.membershipId,
          name: p.name,
          phone: p.phone,
          productId,
          duration,
          startDate
        })
      }

      return results
    },
    { people, membershipProducts, durationByProduct }
  )
  console.log(`Created ${members.length} members.`)

  // Renew six of the monthly members onto a fresh, solidly-active membership
  // (started today) — gives Members a visible renewal history: lastMembership
  // shows the old one, activeMembership shows the new one. The old
  // membership's id came straight back from creation, so no lookup needed.
  const renewCandidates = members.filter((m) => m.duration === 30).slice(0, 6)
  await page.evaluate(async (candidates) => {
    function todayISO() {
      const d = new Date()
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
    for (const c of candidates) {
      await window.api.renewMembership({
        membershipId: c.membershipId,
        newStartDate: todayISO(),
        paymentMethod: Math.random() < 0.5 ? 'cash' : 'qr'
      })
    }
  }, renewCandidates)

  console.log('Ringing up a month of sales...')
  const saleCounts = await page.evaluate(
    async ({ catalog, members }) => {
      function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min
      }
      function pick(arr) {
        return arr[randInt(0, arr.length - 1)]
      }

      const discountReasons = ['Regular customer', 'Off-season rate', 'Staff friend', 'Group booking']
      let poolCount = 0
      let restaurantCount = 0

      // ---- Pool-side sales: mostly day passes / packages, occasional gear ----
      for (let i = 0; i < 55; i++) {
        const cart = []
        const productId = Math.random() < 0.75 ? catalog.dayPassId : catalog.dayPackageId
        const qty = randInt(1, 4)
        const tier = Math.random() < 0.75 ? 'adult' : 'child'
        const line = { kind: 'product', refId: productId, tier, quantity: qty }
        if (Math.random() < 0.08) {
          line.discount = randInt(20, 60)
          line.discountReason = pick(discountReasons)
        }
        cart.push(line)
        if (Math.random() < 0.25) {
          const item = pick(catalog.poolItems)
          cart.push({ kind: 'pool_item', refId: item.id, quantity: randInt(1, 2) })
        }

        const quote = await window.api.quoteSale({ cart })
        if (!quote.success || quote.shortfalls?.length) continue

        let customerName
        let phone
        let memberId = null
        if (Math.random() < 0.3) {
          const member = pick(members)
          customerName = member.name
          phone = member.phone
          memberId = member.memberId
        } else {
          customerName = 'Walk-in'
        }

        let payments
        if (Math.random() < 0.1 && quote.total > 20) {
          const first = Math.round(quote.total * 0.6)
          payments = [
            { amount: first, method: 'cash' },
            { amount: Math.round((quote.total - first) * 100) / 100, method: 'qr' }
          ]
        } else {
          payments = [{ amount: quote.total, method: Math.random() < 0.7 ? 'cash' : 'qr' }]
        }

        const res = await window.api.createSale({ cart, customerName, phone, memberId, payments })
        if (res.success) poolCount++
      }

      // ---- Restaurant-side sales ----
      for (let i = 0; i < 38; i++) {
        const lineCount = randInt(1, 3)
        const cart = []
        const chosen = new Set()
        for (let j = 0; j < lineCount; j++) {
          const item = pick(catalog.menuItems)
          if (chosen.has(item.id)) continue
          chosen.add(item.id)
          cart.push({ kind: 'menu_item', refId: item.id, quantity: randInt(1, 3) })
        }
        if (!cart.length) continue

        const quote = await window.api.quoteSale({ cart })
        if (!quote.success || quote.shortfalls?.length) continue

        const customerName = Math.random() < 0.2 ? pick(members).name : 'Walk-in'
        const payments = [{ amount: quote.total, method: Math.random() < 0.6 ? 'cash' : 'qr' }]
        const res = await window.api.createSale({ cart, customerName, payments })
        if (res.success) restaurantCount++
      }

      return { poolCount, restaurantCount }
    },
    { catalog, members }
  )
  console.log(`Sales created: ${JSON.stringify(saleCounts)}`)

  console.log('Creating bookings...')
  await page.evaluate(async () => {
    function addDaysISO(offset) {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    const plans = [
      {
        offset: 5,
        name: 'Shrestha family swim party',
        contact: 'Anita Shrestha',
        phone: '9800000001',
        slot: '4:00 PM - 6:00 PM',
        people: 8,
        facilities: 'pool',
        deposit: 3000,
        method: 'cash',
        total: 8000,
        status: 'confirmed'
      },
      {
        offset: 12,
        name: 'Corporate team outing',
        contact: 'Rajesh Shrestha',
        phone: '9800000002',
        slot: '10:00 AM - 2:00 PM',
        people: 25,
        facilities: 'pool,restaurant',
        deposit: 5000,
        method: 'qr',
        total: 20000,
        status: 'pending'
      },
      {
        offset: 3,
        name: 'Birthday pool party',
        contact: 'Sabina Gurung',
        phone: '9800000003',
        slot: '3:00 PM - 5:00 PM',
        people: 15,
        facilities: 'pool',
        deposit: 4000,
        method: 'cash',
        total: 10000,
        status: 'confirmed'
      },
      {
        offset: 20,
        name: 'Swim class group',
        contact: 'Bikash Tamang',
        phone: '9800000004',
        slot: '9:00 AM - 10:00 AM',
        people: 10,
        facilities: 'pool',
        deposit: 0,
        method: null,
        total: 5000,
        status: 'pending'
      },
      {
        offset: -5,
        name: 'Gurung wedding after-party',
        contact: 'Sujan Gurung',
        phone: '9800000005',
        slot: '6:00 PM - 10:00 PM',
        people: 40,
        facilities: 'pool,restaurant',
        deposit: 8000,
        method: 'cash',
        total: 25000,
        status: 'completed'
      },
      {
        offset: -12,
        name: 'School swim trip',
        contact: 'Prakash Rai',
        phone: '9800000006',
        slot: '9:00 AM - 12:00 PM',
        people: 30,
        facilities: 'pool',
        deposit: 6000,
        method: 'qr',
        total: 15000,
        status: 'completed'
      },
      {
        offset: -20,
        name: 'Office farewell',
        contact: 'Nabin Thapa',
        phone: '9800000007',
        slot: '7:00 PM - 9:00 PM',
        people: 18,
        facilities: 'restaurant',
        deposit: 3000,
        method: 'cash',
        total: 9000,
        status: 'completed'
      },
      {
        offset: -8,
        name: 'Anniversary dinner',
        contact: 'Sandip Karki',
        phone: '9800000008',
        slot: '7:00 PM - 9:00 PM',
        people: 6,
        facilities: 'restaurant',
        deposit: 1000,
        method: 'cash',
        total: 3000,
        status: 'cancelled'
      },
      {
        offset: -25,
        name: 'Kids swim camp day',
        contact: 'Bishal Magar',
        phone: '9800000009',
        slot: '9:00 AM - 12:00 PM',
        people: 20,
        facilities: 'pool',
        deposit: 4000,
        method: 'cash',
        total: 8000,
        status: 'completed'
      },
      {
        offset: 8,
        name: 'Reunion party',
        contact: 'Arjun Basnet',
        phone: '9800000010',
        slot: '5:00 PM - 9:00 PM',
        people: 22,
        facilities: 'pool,restaurant',
        deposit: 5000,
        method: 'qr',
        total: 14000,
        status: 'confirmed'
      },
      {
        offset: -2,
        name: 'Weekend pool booking',
        contact: 'Rohit Poudel',
        phone: '9800000011',
        slot: '11:00 AM - 1:00 PM',
        people: 12,
        facilities: 'pool',
        deposit: 2000,
        method: 'cash',
        total: 6000,
        status: 'completed'
      },
      {
        offset: 1,
        name: 'Staff appreciation lunch',
        contact: 'Sagar Adhikari',
        phone: '9800000012',
        slot: '1:00 PM - 3:00 PM',
        people: 10,
        facilities: 'restaurant',
        deposit: 1500,
        method: 'cash',
        total: 4000,
        status: 'confirmed'
      }
    ]

    for (const plan of plans) {
      const booking = await window.api.createBooking({
        bookingName: plan.name,
        contactPerson: plan.contact,
        contactPhone: plan.phone,
        bookingDate: addDaysISO(plan.offset),
        timeSlot: plan.slot,
        numPeople: plan.people,
        facilitiesBooked: plan.facilities,
        depositPaid: plan.deposit,
        depositMethod: plan.method,
        totalExpected: plan.total
      })
      if (plan.status !== 'pending') {
        await window.api.updateBookingStatus({ bookingId: booking.bookingId, status: plan.status })
      }
    }
  })

  console.log('Backfilling EOD cash reconciliations...')
  await page.evaluate(async () => {
    function addDaysISO(offset) {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
    function randInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min
    }
    // Past 22 days, skipping a few at random (a day nobody closed out, which
    // is realistic) — never today, so the staff End of Day screen still shows
    // a live, un-closed form when the tour visits it.
    for (let offset = 1; offset <= 22; offset++) {
      if (Math.random() < 0.15) continue
      const system = randInt(3000, 15000)
      const discrepancy = Math.random() < 0.7 ? 0 : randInt(-100, 100)
      const physical = system + discrepancy
      await window.api.createReconciliation({
        reconcileDate: addDaysISO(-offset),
        systemCash: system,
        physicalCash: physical,
        reason: discrepancy !== 0 ? 'Till count variance' : null
      })
    }
  })

  console.log('Recording check-ins...')
  await page.evaluate(async (members) => {
    for (const m of members) {
      if (Math.random() < 0.82) {
        await window.api.checkIn({ memberId: m.memberId })
      }
    }
  }, members)

  console.log('\nSeed complete. Closing app for the backdate pass...')
} catch (err) {
  console.log('Seed script hit an error:', err.message)
  console.log(err.stack)
} finally {
  if (errors.length) console.log('\nRenderer errors:\n' + errors.join('\n'))
  await app.close()
  // Deliberately no cleanup() — the next phase needs this profile on disk.
}
