import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal, formatShortDate, categoryToUiType } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'
import { validatePrice, validateRequired } from '../lib/validate'
import { CATEGORY_LABELS, CATEGORY_HINTS } from '../../../shared/transaction-types'

const PRODUCT_CATEGORIES = ['day_pass', 'day_package', 'membership']
const DURATION_OPTIONS = [
  { value: 15, label: '15' },
  { value: 30, label: '30 Monthly' },
  { value: 90, label: '90 3 Months' },
  { value: 180, label: '180 6 Months' },
  { value: 365, label: '365 1 Year' }
]

// The owner's own words for the engine's three tiers. `null` is a real case,
// not "no rule": it is a sale that never said which age group it was for, and
// it is what the till uses today. Calling it "Everyone" and saying when it is
// used is the difference between a rate that works and one that quietly isn't.
const TIERS = [
  { value: '', tier: null, label: 'Everyone' },
  { value: 'adult', tier: 'adult', label: 'Adults' },
  { value: 'child', tier: 'child', label: 'Children (6 and under)' }
]
const TIER_VALUES = [null, 'adult', 'child']

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS = WEEKDAYS.map((d) => `${d}s`)
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function tierLabel(tier) {
  const found = TIERS.find((t) => t.tier === (tier || null))
  return found ? found.label : 'Everyone'
}

function dayLabel(day) {
  return day === null || day === undefined ? 'Every day' : DAYS[day]
}

function ruleLabel(rule) {
  return `${tierLabel(rule.tier)} · ${dayLabel(rule.dayOfWeek)}`
}

function joinList(parts) {
  if (parts.length < 2) return parts[0] || ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// The IPC layer hands back SQL NULLs as null and days as numbers, but a missing
// key reads as undefined — and every comparison below is an identity test.
function normaliseRule(r) {
  return {
    id: r.id,
    productId: r.productId,
    tier: r.tier ?? null,
    dayOfWeek: r.dayOfWeek === null || r.dayOfWeek === undefined ? null : Number(r.dayOfWeek),
    price: Number(r.price),
    activeFrom: r.activeFrom
  }
}

function ruleMatches(rule, tier, day) {
  return (
    (rule.tier === null || rule.tier === tier) &&
    (rule.dayOfWeek === null || rule.dayOfWeek === day)
  )
}

// Mirrors the engine's ORDER BY (tier, then day, then newest start date) so the
// screen can name WHICH rate wins a slot. Deliberately not a second pricing
// engine: every rupee shown on this screen comes from a real quote (see
// quoteTiers) — this only attributes those numbers to a rule so the owner can
// be told why a rate they typed is not the one being charged.
function winningRule(rules, tier, day, onDate) {
  return (
    rules
      .filter((r) => r.activeFrom <= onDate && ruleMatches(r, tier, day))
      .sort(
        (a, b) =>
          (b.tier ? 1 : 0) - (a.tier ? 1 : 0) ||
          (b.dayOfWeek !== null ? 1 : 0) - (a.dayOfWeek !== null ? 1 : 0) ||
          (a.activeFrom < b.activeFrom ? 1 : a.activeFrom > b.activeFrom ? -1 : 0) ||
          b.id - a.id
      )[0] || null
  )
}

function describeSlots(slots) {
  const byTier = new Map()
  for (const s of slots) {
    const key = s.tier || ''
    if (!byTier.has(key)) byTier.set(key, [])
    byTier.get(key).push(s.day)
  }
  return joinList(
    [...byTier.entries()].map(([key, days]) => {
      const label = tierLabel(key || null)
      return days.length === 7 ? label : `${label} on ${joinList(days.map((d) => DAYS[d]))}`
    })
  )
}

// The consequence of "most specific wins" that catches every owner out: an
// adult on a Saturday pays the ADULT rate, because a rate for an age group beats
// a rate for a day. Listing the rules would hide that. This walks all 21
// group/day slots the rule covers and reports the ones it will never be charged
// for — so the screen can say it out loud, before and after saving.
function analyseRule(rule, siblings, today) {
  if (rule.activeFrom > today) {
    return {
      tone: 'amber',
      title: 'Not charging yet',
      desc: `Starts on ${formatShortDate(rule.activeFrom)}. Until then the rate below it applies.`
    }
  }

  const lost = []
  let wins = 0
  for (const tier of TIER_VALUES) {
    for (let day = 0; day < 7; day++) {
      if (!ruleMatches(rule, tier, day)) continue
      const winner = winningRule(siblings, tier, day, today)
      if (winner && winner.id === rule.id) wins += 1
      else lost.push({ tier, day, winner })
    }
  }
  if (!lost.length) return null

  const replacedBy = lost.find(
    (s) => s.winner && s.winner.tier === rule.tier && s.winner.dayOfWeek === rule.dayOfWeek
  )
  if (!wins && replacedBy) {
    return {
      tone: 'red',
      title: 'No longer used',
      desc: `Replaced by the ${fmt(replacedBy.winner.price)} rate that started on ${formatShortDate(
        replacedBy.winner.activeFrom
      )}.`
    }
  }

  const where = describeSlots(lost)
  // The flagship case: an all-ages rate for one day, with age rates in the way.
  const groupsInTheWay =
    rule.tier === null && rule.dayOfWeek !== null
      ? [...new Set(lost.map((s) => s.tier).filter(Boolean))].map(tierLabel)
      : []
  const fix = groupsInTheWay.length
    ? ` A rate for an age group beats a rate for a day. To charge ${fmt(rule.price)} to everyone on ${
        DAYS[rule.dayOfWeek]
      }, add a ${DAYS[rule.dayOfWeek]} rate for ${joinList(groupsInTheWay)} as well.`
    : ''

  if (!wins) {
    return {
      tone: 'red',
      title: 'Not in use',
      desc: `A more exact rate applies to ${where}, so this one is never charged.${fix}`
    }
  }
  return {
    tone: 'amber',
    title: 'Partly overridden',
    desc: `${where} will not use this rate — a more exact rate applies there.${fix}`
  }
}

function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayOfWeekFor(iso) {
  return new Date(`${iso}T00:00:00`).getDay()
}

// Ask the till itself what it would charge, rather than working it out here a
// second time. One quote covers every product × every group, so the list shows
// the amount that would actually land on a receipt today.
async function quoteTiers(products, date) {
  const prices = new Map()
  if (!products.length) return prices
  const cart = []
  for (const p of products) {
    for (const tier of TIER_VALUES) cart.push({ kind: 'product', refId: p.id, tier, quantity: 1 })
  }
  const r = await api.quoteSale({ cart, date })
  if (!r || r.success === false || !Array.isArray(r.lines)) return prices
  r.lines.forEach((line, i) => {
    const product = products[Math.floor(i / TIER_VALUES.length)]
    const tier = TIER_VALUES[i % TIER_VALUES.length]
    if (product) prices.set(`${product.id}:${tier || ''}`, line.unitPrice)
  })
  return prices
}

export function PricingManager({ back }) {
  const [products, setProducts] = useState([])
  const [rules, setRules] = useState([])
  const [todayPrices, setTodayPrices] = useState(new Map())
  const [historyId, setHistoryId] = useState(null)
  const [history, setHistory] = useState([])
  const [editId, setEditId] = useState(null)
  const [editPrice, setEditPrice] = useState('')
  const [addingProduct, setAddingProduct] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('day_pass')
  const [newPrice, setNewPrice] = useState('')
  const [newDuration, setNewDuration] = useState(30)
  const [adding, setAdding] = useState(false)
  const [editor, setEditor] = useState(null)
  const [formError, setFormError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [week, setWeek] = useState(null)
  const [error, setError] = useState('')

  const today = todayLocal()

  const load = useCallback(async () => {
    const [productResult, ruleResult] = await Promise.all([
      api.listProducts({ activeOnly: false }),
      api.listPriceRules({})
    ])
    const list = productResult.products || []
    setProducts(list)
    if (ruleResult?.success === false) setError(ruleResult.error || 'Could not read the price list')
    setRules((ruleResult?.rules || []).map(normaliseRule))
    setTodayPrices(
      await quoteTiers(
        list.filter((p) => p.is_active !== 0),
        todayLocal()
      )
    )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const closePanels = () => {
    setEditor(null)
    setConfirmRemove(null)
    setWeek(null)
    setHistoryId(null)
    setFormError('')
    setAddingProduct(false)
    setEditId(null)
  }

  const resetAddForm = () => {
    setAddingProduct(false)
    setNewName('')
    setNewCategory('day_pass')
    setNewPrice('')
    setNewDuration(30)
    setAdding(false)
  }

  const openAddProduct = () => {
    setError('')
    closePanels()
    setAddingProduct(true)
  }

  const rulesFor = (productId) => rules.filter((r) => r.productId === productId)
  const productName = (id) => {
    const p = products.find((x) => x.id === id)
    return p ? p.displayName || p.name : ''
  }

  // ---- Base price (unchanged behaviour: products:update-price + history) ----

  const savePrice = async (id) => {
    setError('')
    const invalid = validateRequired(editPrice, 'Price') || validatePrice(editPrice)
    if (invalid) {
      setError(invalid)
      return
    }
    const r = await api.updatePrice({ productId: id, newPrice: Number(editPrice) })
    if (r?.success === false) {
      setError(r.error || 'Could not update price')
      return
    }
    setEditId(null)
    setEditPrice('')
    load()
  }

  const saveProduct = async () => {
    if (adding) return
    setError('')
    const invalid = validateRequired(newName, 'Name') || validatePrice(newPrice)
    if (invalid) {
      setError(invalid)
      return
    }
    setAdding(true)
    const r = await api.addProduct({
      name: newName.trim(),
      category: newCategory,
      price: Number(newPrice),
      durationDays: newCategory === 'membership' ? Number(newDuration) : null
    })
    setAdding(false)
    if (r?.success === false) {
      setError(r.error || 'Could not add product')
      return
    }
    resetAddForm()
    load()
  }

  const toggleSelling = async (p) => {
    setError('')
    const r = await api.toggleProduct({ productId: p.id, isActive: p.is_active === 0 })
    if (r?.success === false) {
      setError(r.error || 'Could not update product')
      return
    }
    load()
  }

  const showHistory = async (id) => {
    setError('')
    closePanels()
    setHistoryId(id)
    const r = await api.priceHistory({ productId: id })
    // A failed lookup used to render as an empty history card, indistinguishable
    // from a product whose price has genuinely never changed.
    if (r.error) setError(r.error)
    setHistory(r.history || [])
  }

  // ---- Price rules ----

  const openEditor = (productId, rule) => {
    setError('')
    closePanels()
    setEditor({
      productId,
      original: rule || null,
      tier: rule ? rule.tier || '' : '',
      day: rule && rule.dayOfWeek !== null ? String(rule.dayOfWeek) : '',
      price: rule ? String(rule.price) : '',
      activeFrom: rule ? rule.activeFrom : today
    })
  }

  // The handler refuses these too, but an owner should not have to click Save to
  // find out that Rs. -500 is not a price.
  const priceProblem = (value) => {
    if (validateRequired(value, 'Price')) return 'Enter a price.'
    if (validatePrice(value)) return 'A price cannot be less than zero.'
    if (!Number.isInteger(Number(value))) return 'Prices are whole rupees — no paisa.'
    return null
  }

  const saveRule = async () => {
    setFormError('')
    const problem = priceProblem(editor.price)
    if (problem) {
      setFormError(problem)
      return
    }
    const payload = {
      productId: editor.productId,
      tier: editor.tier || null,
      dayOfWeek: editor.day === '' ? null : Number(editor.day),
      price: Number(editor.price),
      activeFrom: editor.activeFrom || today
    }
    const r = await api.setPriceRule(payload)
    if (r?.success === false) {
      setFormError(r.error || 'Could not save this price')
      return
    }
    // Saving is an upsert keyed on group + day + start date. Change any of those
    // while editing and the save lands on a NEW rate, leaving the old one behind
    // still charging people — so retire the one the owner was editing.
    const before = editor.original
    if (
      before &&
      (before.tier !== payload.tier ||
        before.dayOfWeek !== payload.dayOfWeek ||
        before.activeFrom !== payload.activeFrom)
    ) {
      const removed = await api.deletePriceRule({ ruleId: before.id })
      // The new rate is already saved at this point. If retiring the old one
      // fails, both are live — and in some day/group slots the old one is the
      // more specific match, so the till would keep charging the price the
      // owner just moved away from. Say so instead of showing success.
      if (removed?.success === false) {
        setError(
          removed.error ||
            'The new price was saved, but the old one could not be removed — both are active. Remove the old one below.'
        )
        setEditor(null)
        await load()
        return
      }
    }
    setEditor(null)
    await load()
  }

  const removeRule = async (rule) => {
    setError('')
    const r = await api.deletePriceRule({ ruleId: rule.id })
    if (r?.success === false) {
      setError(r.error || 'Could not remove this price')
      return
    }
    setConfirmRemove(null)
    await load()
  }

  const openWeek = async (product) => {
    setError('')
    closePanels()
    // sales:quote refuses to price a retired product (correctly — it can't be
    // sold), so every one of the 7 days × 3 tiers below would fail silently
    // and the grid would render as 21 blank cells with no explanation. Say
    // why instead of attempting a quote that can only ever fail.
    if (product.is_active === 0) {
      setError(`${product.name} is no longer sold, so there's no current pricing to check.`)
      return
    }
    const days = []
    for (let i = 0; i < 7; i += 1) {
      const iso = shiftDate(today, i)
      days.push({ iso, dow: dayOfWeekFor(iso) })
    }
    const cells = new Map()
    for (const d of days) {
      const quoted = await quoteTiers([product], d.iso)
      for (const tier of TIER_VALUES) {
        cells.set(`${d.iso}:${tier || ''}`, quoted.get(`${product.id}:${tier || ''}`))
      }
    }
    setWeek({ productId: product.id, days, cells })
  }

  const priceToday = (productId, tier) => {
    const value = todayPrices.get(`${productId}:${tier || ''}`)
    return value === undefined ? null : value
  }

  // What removing a rate would leave behind, in rupees, before the owner commits.
  const fallbackAfterRemoving = (rule) => {
    const product = products.find((p) => p.id === rule.productId)
    const day = rule.dayOfWeek === null ? dayOfWeekFor(today) : rule.dayOfWeek
    const survivor = winningRule(
      rulesFor(rule.productId).filter((r) => r.id !== rule.id),
      rule.tier,
      day,
      today
    )
    if (survivor) {
      return `${tierLabel(rule.tier)} will then pay ${fmt(survivor.price)} — the ${ruleLabel(
        survivor
      )} rate.`
    }
    return `${tierLabel(rule.tier)} will then pay the standard price, ${fmt(product?.price || 0)}.`
  }

  const editorPreview = () => {
    if (!editor) return null
    const problem = priceProblem(editor.price)
    if (problem) return null
    const existingSiblings = rulesFor(editor.productId).filter(
      (r) => !editor.original || r.id !== editor.original.id
    )
    const draft = {
      // A brand-new rule doesn't have a real id yet, but winningRule()'s tie
      // break (highest id wins) has to already treat it the way it'll behave
      // once saved: a genuinely new row gets an id higher than every existing
      // one. Giving it `-1` here did the opposite — a draft that exactly
      // matches an existing rule's tier/day/date always LOST that tiebreak to
      // the real row, so the preview said the new rule would be "replaced by"
      // the old one, when saving actually does the reverse (the new row wins
      // and the old one stops applying).
      id: editor.original
        ? editor.original.id
        : Math.max(0, ...existingSiblings.map((r) => r.id)) + 1,
      tier: editor.tier || null,
      dayOfWeek: editor.day === '' ? null : Number(editor.day),
      price: Number(editor.price),
      activeFrom: editor.activeFrom || today
    }
    const siblings = [...existingSiblings, draft]
    const note = analyseRule(draft, siblings, today)
    return note ? { ...note, title: `Before you save — ${note.title.toLowerCase()}` } : null
  }

  const preview = editorPreview()
  const topRow = { borderTop: '2px solid #cbd5e1' }

  // Every panel opens underneath a price list that is easily taller than the
  // screen, so on all but the first product the button looked like it had done
  // nothing at all. Only one panel is open at a time, hence the single ref.
  const panelRef = useRef(null)
  const openPanel = editor
    ? `editor-${editor.productId}`
    : confirmRemove
      ? `remove-${confirmRemove.id}`
      : week
        ? `week-${week.productId}`
        : historyId
          ? `history-${historyId}`
          : null
  useEffect(() => {
    if (openPanel) panelRef.current?.scrollIntoView({ block: 'nearest' })
  }, [openPanel])

  return (
    <div className="content fade-in">
      <SectionHead title="Pricing manager">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
        <button className="btn btn-primary" onClick={openAddProduct}>
          <Icon name="plus" size={15} /> Add product
        </button>
      </SectionHead>

      {error && (
        <div className="alert red" style={{ marginBottom: 12 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}

      <div
        className="card"
        style={{ padding: '12px 14px', marginBottom: 14, display: 'flex', gap: 10 }}
      >
        <Icon name="tag" size={16} color="#185FA5" />
        <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
          {rules.length === 0 ? (
            <>
              Everything is sold at its <b>standard price</b> right now. Add a rate below only where
              you charge something different — less for children, or less on one day of the week.{' '}
              <b>Add nothing and nothing changes.</b>
            </>
          ) : (
            <>
              Where two rates could apply, the <b>more exact one wins</b> — a rate for an age group
              beats a rate for a day. Anything not covered falls back to the standard price.
            </>
          )}
        </div>
      </div>

      {addingProduct && (
        <div className="card" style={{ marginTop: 0, marginBottom: 14, padding: 16, maxWidth: 620 }}>
          <div style={{ fontWeight: 500, marginBottom: 12 }}>Add product</div>
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Type</label>
            <select
              className="select"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <div className="sub" style={{ marginTop: 5 }}>
              {CATEGORY_HINTS[newCategory]}
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Price</label>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
            </div>
            {newCategory === 'membership' && (
              <div className="field" style={{ flex: 1 }}>
                <label>Duration</label>
                <select
                  className="select"
                  value={newDuration}
                  onChange={(e) => setNewDuration(e.target.value)}
                >
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" disabled={adding} onClick={saveProduct}>
              Save product
            </button>
            <button className="btn btn-ghost" onClick={resetAddForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: '20%' }}>Product</th>
            <th>Who and when</th>
            <th className="num" style={{ width: 110 }}>
              Price
            </th>
            <th style={{ width: 120 }}>Starting</th>
            <th style={{ width: 240 }}></th>
          </tr>
        </thead>
        {products.map((p) => {
          const productRules = rulesFor(p.id)
          return (
            <tbody key={p.id} className="price-group">
              <tr>
                <td style={{ ...topRow, fontWeight: 500, verticalAlign: 'top' }}>
                  {p.displayName || p.name}
                  <div className="sub" style={{ marginTop: 2 }}>
                    {categoryToUiType(p.category)}
                  </div>
                  {p.is_active === 0 && <div className="sub">No longer sold</div>}
                </td>
                <td style={topRow}>
                  Standard price
                  <div className="sub" style={{ marginTop: 2 }}>
                    Charged whenever no rate below applies.
                  </div>
                </td>
                <td className="num" style={topRow}>
                  {editId === p.id ? (
                    <input
                      className="input"
                      type="number"
                      style={{ width: 90 }}
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                    />
                  ) : (
                    fmt(p.price)
                  )}
                </td>
                <td className="sub" style={topRow}>
                  Always
                </td>
                <td style={topRow}>
                  {editId === p.id ? (
                    <>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => savePrice(p.id)}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11, marginLeft: 6 }}
                        onClick={() => {
                          setEditId(null)
                          setEditPrice('')
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => {
                          setError('')
                          closePanels()
                          setEditId(p.id)
                          setEditPrice(String(p.price))
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11, marginLeft: 6 }}
                        onClick={() => showHistory(p.id)}
                      >
                        History
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11, marginLeft: 6 }}
                        onClick={() => toggleSelling(p)}
                      >
                        {p.is_active === 0 ? 'Sell again' : 'Stop selling'}
                      </button>
                    </>
                  )}
                </td>
              </tr>

              {productRules.map((r) => {
                const note = analyseRule(r, productRules, today)
                return (
                  <tr key={r.id} className="price-rule">
                    <td></td>
                    <td>
                      {ruleLabel(r)}
                      {r.tier === null && (
                        <span className="sub"> — when the sale does not say adult or child</span>
                      )}
                      {note && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11.5,
                            lineHeight: 1.5,
                            color: note.tone === 'red' ? '#991b1b' : '#92400e'
                          }}
                        >
                          <Icon
                            name="alert-triangle"
                            size={12}
                            style={{ marginRight: 5, verticalAlign: '-1px' }}
                          />
                          <b>{note.title}.</b> {note.desc}
                        </div>
                      )}
                    </td>
                    <td className="num">{fmt(r.price)}</td>
                    <td className="sub">{formatShortDate(r.activeFrom)}</td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => openEditor(p.id, r)}
                      >
                        Change
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11, marginLeft: 6 }}
                        onClick={() => {
                          setError('')
                          closePanels()
                          setConfirmRemove(r)
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}

              <tr>
                <td></td>
                <td colSpan={3}>
                  <div className="sub">Charging today, {WEEKDAYS[dayOfWeekFor(today)]}</div>
                  <div style={{ marginTop: 3, fontSize: 12.5 }}>
                    {TIERS.map((t, i) => {
                      const value = priceToday(p.id, t.tier)
                      return (
                        <span key={t.value}>
                          {i > 0 && <span style={{ color: '#cbd5e1' }}> · </span>}
                          <span style={{ color: '#64748b' }}>{t.label} </span>
                          <b>{value === null ? '—' : fmt(value)}</b>
                        </span>
                      )
                    })}
                  </div>
                </td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => openEditor(p.id, null)}
                  >
                    <Icon name="plus" size={12} /> Add a price
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 11, marginTop: 6 }}
                    onClick={() => openWeek(p)}
                  >
                    <Icon name="calendar-days" size={12} /> Check the week
                  </button>
                </td>
              </tr>
            </tbody>
          )
        })}
      </table>

      {products.length === 0 && (
        <div className="card" style={{ padding: 22, textAlign: 'center', marginTop: 12 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>No products yet</div>
          <div className="sub" style={{ marginBottom: 12 }}>
            Add an entry ticket, combo ticket, or membership with the Add product button.
          </div>
          <button className="btn btn-primary" onClick={openAddProduct}>
            <Icon name="plus" size={15} /> Add product
          </button>
        </div>
      )}

      <div ref={panelRef}>
        {editor && (
          <div className="card" style={{ marginTop: 14, padding: 16, maxWidth: 620 }}>
            <div style={{ fontWeight: 500 }}>
              {editor.original ? 'Change a price' : 'Add a price'}
            </div>
            <div className="sub" style={{ marginBottom: 12 }}>
              {productName(editor.productId)}
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Who is this price for?</label>
                <select
                  className="select"
                  value={editor.tier}
                  onChange={(e) => setEditor({ ...editor, tier: e.target.value })}
                >
                  {TIERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {editor.tier === '' && (
                  <div className="sub" style={{ marginTop: 5 }}>
                    Used when the sale does not say adult or child.
                  </div>
                )}
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Which days?</label>
                <select
                  className="select"
                  value={editor.day}
                  onChange={(e) => setEditor({ ...editor, day: e.target.value })}
                >
                  <option value="">Every day</option>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Price</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={editor.price}
                  onChange={(e) => setEditor({ ...editor, price: e.target.value })}
                />
                <div className="sub" style={{ marginTop: 5 }}>
                  Whole rupees. A price cannot be less than zero.
                </div>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Starts from</label>
                <input
                  className="input"
                  type="date"
                  value={editor.activeFrom}
                  onChange={(e) => setEditor({ ...editor, activeFrom: e.target.value })}
                />
                <div className="sub" style={{ marginTop: 5 }}>
                  Leave this as today unless the new rate begins later.
                </div>
              </div>
            </div>

            {preview && (
              <div className={`alert ${preview.tone}`} style={{ marginBottom: 10 }}>
                <div>
                  <div className="a-title">{preview.title}</div>
                  <div className="a-desc">{preview.desc}</div>
                </div>
              </div>
            )}
            {formError && (
              <div className="alert red" style={{ marginBottom: 10 }}>
                <div className="a-desc">{formError}</div>
              </div>
            )}

            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" onClick={saveRule}>
                Save this price
              </button>
              <button className="btn btn-ghost" onClick={() => setEditor(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {confirmRemove && (
          <div className="card" style={{ marginTop: 14, padding: 16, maxWidth: 620 }}>
            <div style={{ fontWeight: 500 }}>
              Remove the {ruleLabel(confirmRemove)} rate for {productName(confirmRemove.productId)}?
            </div>
            <div className="sub" style={{ marginTop: 6, fontSize: 12.5 }}>
              {fallbackAfterRemoving(confirmRemove)}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => removeRule(confirmRemove)}>
                Yes, remove it
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmRemove(null)}>
                Keep it
              </button>
            </div>
          </div>
        )}

        {week && (
          <div className="card price-week" style={{ marginTop: 14, padding: 16 }}>
            <div className="between">
              <div>
                <div style={{ fontWeight: 500 }}>
                  What {productName(week.productId)} will be charged, day by day
                </div>
                <div className="sub" style={{ marginTop: 2 }}>
                  The next seven days, as the till will price them.
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setWeek(null)}>
                Close
              </button>
            </div>
            <table className="tbl" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Who</th>
                  {week.days.map((d, i) => (
                    <th key={d.iso} className="num">
                      {DAY_SHORT[d.dow]}
                      <div className="sub">
                        {i === 0 ? 'today' : formatShortDate(d.iso).slice(0, 6)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIERS.map((t) => (
                  <tr key={t.value}>
                    <td>{t.label}</td>
                    {week.days.map((d, i) => {
                      const value = week.cells.get(`${d.iso}:${t.value}`)
                      return (
                        <td
                          key={d.iso}
                          className="num"
                          style={{ background: i === 0 ? '#f8faff' : undefined }}
                        >
                          {value === undefined ? '—' : fmt(value)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyId && (
          <div className="card" style={{ marginTop: 14, padding: 14 }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>Price history</div>
            {history.length === 0 && <div className="sub">No price changes recorded yet.</div>}
            {history.map((h) => (
              <div
                key={h.id}
                style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}
              >
                {fmt(h.old_price)} → {fmt(h.new_price)} by {h.changed_by_name} · {h.changed_at}
              </div>
            ))}
            <button
              className="btn btn-ghost"
              style={{ marginTop: 8 }}
              onClick={() => setHistoryId(null)}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
