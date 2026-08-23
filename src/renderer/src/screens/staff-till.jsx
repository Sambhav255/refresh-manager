import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { Avatar, Badge, Icon } from '../components/ui'
import { QtyStepper } from '../components/qty-stepper'
import { CART_CATEGORIES, categoryLabel } from '../../../shared/transaction-types'
import { cartGuard, cartPayload, discountsNeedReason } from './staff-transaction'

const FEATURES = { memberPhoto: false }

const MAX_LINE_QUANTITY = 999

const TILL_TABS = [
  { id: 'entry', label: 'Entry' },
  { id: 'shop', label: 'Shop' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'member', label: 'Member' }
]

const TILL_PRODUCT_CATEGORIES = [...CART_CATEGORIES, 'membership']

let nextLineUid = 1

function poolItemLabel(item) {
  return item.variant && item.variant !== '—' ? `${item.name} (${item.variant})` : item.name
}

function productLine(product) {
  return {
    uid: nextLineUid++,
    kind: 'product',
    refId: product.id,
    name: product.displayName || product.name,
    tier: 'adult',
    quantity: 1,
    discount: '',
    discountReason: '',
    showDiscount: false
  }
}

function poolLine(item) {
  return {
    uid: nextLineUid++,
    kind: 'pool_item',
    refId: item.id,
    name: poolItemLabel(item),
    tier: null,
    quantity: 1,
    discount: '',
    discountReason: '',
    showDiscount: false
  }
}

function menuLine(item) {
  return {
    uid: nextLineUid++,
    kind: 'menu_item',
    refId: item.id,
    name: item.name,
    tier: null,
    quantity: 1,
    discount: '',
    discountReason: '',
    showDiscount: false
  }
}

function lineKey(line) {
  return (
    line.kind + ':' + line.refId + (line.kind === 'product' ? ':' + (line.tier || 'adult') : '')
  )
}

function groupEntryProducts(products, counts = {}) {
  const grouped = {}
  for (const c of CART_CATEGORIES) grouped[c] = []
  for (const p of products) {
    if (grouped[p.category]) grouped[p.category].push(p)
  }
  for (const c of CART_CATEGORIES) {
    grouped[c].sort(
      (a, b) =>
        (counts[b.id] || 0) - (counts[a.id] || 0) ||
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
    )
  }
  return grouped
}

function groupTillProducts(products, counts = {}) {
  const grouped = {}
  for (const c of TILL_PRODUCT_CATEGORIES) grouped[c] = []
  for (const p of products) {
    if (!grouped[p.category]) grouped[p.category] = []
    grouped[p.category].push(p)
  }
  for (const c of TILL_PRODUCT_CATEGORIES) {
    grouped[c].sort(
      (a, b) =>
        (counts[b.id] || 0) - (counts[a.id] || 0) ||
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
    )
  }
  return grouped
}

function durationLabel(days) {
  if (days == null) return ''
  if (days === 15) return '15 Days'
  if (days === 30) return 'Monthly'
  if (days === 90) return '3 Months'
  if (days === 180) return '6 Months'
  if (days === 365) return '1 Year'
  return `${days} Days`
}

export function StaffTill({ onDone, hideKitchen = false, initialTab = 'entry' }) {
  const visibleTabs = hideKitchen ? TILL_TABS.filter((t) => t.id !== 'kitchen') : TILL_TABS
  const defaultTab = visibleTabs.some((t) => t.id === initialTab)
    ? initialTab
    : visibleTabs[0]?.id || 'entry'

  const [tab, setTab] = useState(defaultTab)
  const [q, setQ] = useState('')
  const [cart, setCart] = useState([])
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [pay, setPay] = useState('Cash')
  const [partAmount, setPartAmount] = useState('')
  const [saved, setSaved] = useState(false)
  const [savedTxn, setSavedTxn] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [grouped, setGrouped] = useState({})
  const [tillGrouped, setTillGrouped] = useState({})
  const [products, setProducts] = useState([])
  const [poolItems, setPoolItems] = useState([])
  const [menu, setMenu] = useState([])
  const [plan, setPlan] = useState('')
  const [productId, setProductId] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberPhone, setMemberPhone] = useState('')
  const [matches, setMatches] = useState([])
  const [savingChoice, setSavingChoice] = useState(null)
  const [photoBase64, setPhotoBase64] = useState(null)
  const quoteSeqRef = useRef(0)

  const isMember = tab === 'member'

  useEffect(() => {
    cartGuard.hasItems = cart.length > 0 && !saved
  }, [cart, saved])

  useEffect(() => {
    return () => {
      cartGuard.hasItems = false
    }
  }, [])

  useEffect(() => {
    Promise.all([
      api.listProducts(),
      api.productPopularity(),
      api.listPoolInventory(),
      api.listMenuItems()
    ])
      .then(([r, pop, inv, menuRes]) => {
        const list = r.products || []
        const counts = {}
        for (const c of pop.counts || []) counts[c.productId] = c.count
        setProducts(list)
        setGrouped(groupEntryProducts(list, counts))
        setTillGrouped(groupTillProducts(list, counts))
        setPoolItems((inv.items || []).filter((i) => i.isActive && i.price > 0))
        setMenu(menuRes.items || [])
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        setLoadError('Could not load the catalogue. Leave this screen and open it again.')
      })
  }, [])

  useEffect(() => {
    if (cart.length === 0) {
      setQuote(null)
      setQuoteError('')
      return
    }
    const seq = ++quoteSeqRef.current
    api.quoteSale({ cart: cartPayload(cart) }).then((r) => {
      if (seq !== quoteSeqRef.current) return
      if (!r || r.success === false) {
        setQuoteError(r?.error || 'Could not price this basket')
        setQuote(null)
        return
      }
      setQuoteError('')
      setQuote(r)
    })
  }, [cart])

  const membershipProduct = products.find((p) => String(p.id) === String(productId))
  const membershipPlans = [...new Set((tillGrouped.membership || []).map((p) => p.name))]
  const planDurations = (tillGrouped.membership || [])
    .filter((p) => p.name === plan)
    .sort((a, b) => (a.duration_days || 0) - (b.duration_days || 0))

  const goodsTotal = quote?.total ?? 0
  const memberTotal = membershipProduct?.price ?? 0
  const total = isMember ? memberTotal : goodsTotal
  const partPaid = Number(partAmount) || 0
  const isPartPay = !isMember && partPaid > 0 && partPaid < goodsTotal
  const paidNow = isPartPay ? partPaid : total
  const balance = Math.round((total - paidNow) * 100) / 100
  const needsReason = discountsNeedReason(cart)
  const partAmountInvalid = partAmount.trim() !== '' && !(partPaid > 0 && partPaid < goodsTotal)

  const editLine = (uid, patch) =>
    setCart((c) => c.map((l) => (l.uid === uid ? { ...l, ...patch } : l)))
  const removeLine = (uid) => setCart((c) => c.filter((l) => l.uid !== uid))

  const addOrBump = (line) => {
    setCart((c) => {
      const key = lineKey(line)
      const existing = c.find((l) => lineKey(l) === key)
      if (existing) {
        return c.map((l) =>
          l.uid === existing.uid
            ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + line.quantity) }
            : l
        )
      }
      return [...c, line]
    })
  }

  const setLineQty = (uid, quantity) => {
    if (quantity <= 0) {
      removeLine(uid)
      return
    }
    setCart((c) =>
      c.map((l) => (l.uid === uid ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, quantity) } : l))
    )
  }

  const reset = () => {
    setSaved(false)
    setSavedTxn(null)
    setMatches([])
    setSavingChoice(null)
    setCart([])
    setQuote(null)
    setQuoteError('')
    setCustomerName('')
    setMemberName('')
    setMemberPhone('')
    setPlan('')
    setProductId('')
    setPhotoBase64(null)
    setPay('Cash')
    setPartAmount('')
    setError('')
    setQ('')
  }

  const saveMembership = async (existing) => {
    setSaving(true)
    setSavingChoice(existing ? existing.id : 'new')
    setError('')

    const result = await api.createMemberWithMembership({
      memberId: existing?.id,
      name: memberName.trim(),
      phone: memberPhone || null,
      productId: membershipProduct?.id,
      startDate: todayLocal(),
      paymentMethod: pay.toLowerCase()
    })
    if (result?.success === false) {
      setSaving(false)
      setSavingChoice(null)
      setError(result.error || 'Failed to save membership')
      return
    }

    let photoPath = existing?.photoPath || null
    if (FEATURES.memberPhoto && photoBase64) {
      const photoResult = await api.savePhoto({ memberId: result.memberId, base64: photoBase64 })
      if (photoResult?.success !== false) photoPath = photoResult.photoPath
    }

    setSaving(false)
    setSavingChoice(null)
    setMatches([])
    setSavedTxn({
      transactionId: result.transactionId,
      product: membershipProduct?.displayName || membershipProduct?.name,
      amount: memberTotal,
      paid: memberTotal,
      balance: 0,
      pay,
      isMembership: true,
      memberId: result.memberId,
      memberName: existing?.name || memberName.trim(),
      startDate: result.startDate,
      endDate: result.endDate,
      photoPath
    })
    setSaved(true)
  }

  const handleMemberCharge = async () => {
    if (saving || !productId || !memberName.trim()) return
    setSaving(true)
    setError('')

    const lookup = await api.findMemberMatches({
      name: memberName.trim(),
      phone: memberPhone || null
    })
    if (lookup?.success === false) {
      setSaving(false)
      setError(lookup.error || 'Could not check for an existing member')
      return
    }
    if (lookup?.matches?.length) {
      setSaving(false)
      setMatches(lookup.matches)
      return
    }
    await saveMembership(null)
  }

  const handleCharge = async () => {
    if (isMember) {
      await handleMemberCharge()
      return
    }
    if (saving || cart.length === 0 || needsReason || quoteError || partAmountInvalid) return
    setSaving(true)
    setError('')

    const payment = isPartPay
      ? { payments: [{ amount: partPaid, method: pay.toLowerCase() }] }
      : { paymentMethod: pay.toLowerCase() }

    const result = await api.createSale({
      customerName: customerName.trim() || undefined,
      cart: cartPayload(cart),
      ...payment
    })
    setSaving(false)
    if (result?.success === false) {
      setError(result.error || 'Failed to save transaction')
      return
    }
    setSavedTxn({
      transactionId: result.transactionId,
      amount: result.total,
      paid: result.paid,
      balance: result.balance,
      pay
    })
    setSaved(true)
  }

  const query = q.trim().toLowerCase()

  const entryItems = CART_CATEGORIES.flatMap((c) =>
    (grouped[c] || [])
      .filter((p) => p.is_active !== 0 && Number(p.price) > 0)
      .map((p) => ({ ...p, _group: c }))
  ).filter((p) => !query || (p.displayName || p.name).toLowerCase().includes(query))

  const shopItems = poolItems.filter(
    (i) => !query || `${i.name || ''} ${i.variant || ''}`.toLowerCase().includes(query)
  )

  const kitchenItems = (
    query ? menu.filter((m) => (m.name || '').toLowerCase().includes(query)) : menu
  ).filter((m) => m.is_active !== 0)

  const chargeDisabled = isMember
    ? !productId || !memberName.trim() || saving
    : cart.length === 0 || needsReason || !!quoteError || partAmountInvalid || saving

  if (saved) {
    return (
      <div className="content fade-in" style={{ display: 'grid', placeItems: 'center' }}>
        <div
          className="card scale-in"
          style={{ width: 420, padding: '34px 28px', textAlign: 'center' }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: '#dcfce7',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 16px'
            }}
          >
            <Icon name="check" size={30} color="#16a34a" />
          </div>
          <div style={{ fontSize: 17, fontWeight: 500 }}>Sale saved</div>
          <div className="sub" style={{ marginTop: 6 }}>
            {savedTxn?.product ? `${savedTxn.product} · ` : ''}
            {fmt(savedTxn?.amount)} · {savedTxn?.pay}
          </div>
          {savedTxn?.balance > 0 && (
            <div className="alert amber" style={{ marginTop: 14, textAlign: 'left' }}>
              <Icon name="alert-triangle" size={17} />
              <div>
                <div className="a-title">{fmt(savedTxn.balance)} still to collect</div>
                <div className="a-desc">
                  Paid now {fmt(savedTxn.paid)} of {fmt(savedTxn.amount)}.
                </div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            <button className="btn btn-ghost btn-block" onClick={reset}>
              New sale
            </button>
            <button className="btn btn-primary btn-block" onClick={() => onDone('home')}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (matches.length > 0) {
    return (
      <div
        className="content fade-in"
        style={{ display: 'grid', placeItems: 'start center', paddingTop: 26 }}
      >
        <div className="card scale-in" style={{ width: 500, padding: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>
            {matches.length === 1 ? 'This customer may already be a member' : 'Possible matches'}
          </div>
          <p className="sub" style={{ marginTop: 6, marginBottom: 14 }}>
            Adding the membership to an existing record keeps their check-ins, photo and history in
            one place. If this is a different person, create a new member instead.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {matches.map((m) => {
              const mem = m.activeMembership
              const last = m.lastMembership
              const status = mem?.uiStatus || 'Expired'
              const history = mem
                ? `${mem.productName} · expires ${mem.endDisplay}`
                : last
                  ? `${last.productName} · ended ${last.endDisplay}`
                  : 'No membership on record'
              return (
                <div
                  key={m.id}
                  className="card"
                  style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14 }}
                >
                  <Avatar initials={m.initials} status={status} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                    <div className="sub" style={{ color: '#64748b', marginTop: 2 }}>
                      {m.phone || 'No phone'} · {history}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                      {m.matchedOn === 'phone' ? 'Same phone number' : 'Same name'}
                    </div>
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      alignItems: 'flex-end'
                    }}
                  >
                    <Badge kind={status} />
                    <button
                      className="btn btn-primary"
                      style={{ padding: '5px 11px', fontSize: 12 }}
                      disabled={saving}
                      onClick={() => saveMembership(m)}
                    >
                      {savingChoice === m.id ? 'Saving…' : 'This is them'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {error && (
            <div className="alert red" style={{ marginTop: 14 }}>
              <Icon name="alert-triangle" size={17} />
              <div className="a-desc">{error}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => {
                setMatches([])
                setError('')
              }}
            >
              <Icon name="chevron-left" size={16} /> Back
            </button>
            <div className="spacer" />
            <button
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => saveMembership(null)}
            >
              {savingChoice === 'new' ? 'Saving…' : 'None of these — new member'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="content fade-in"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}
    >
      {loadError && (
        <div className="alert red">
          <Icon name="alert-triangle" size={17} />
          <div className="a-desc">{loadError}</div>
        </div>
      )}

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {visibleTabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 16,
          minHeight: 0
        }}
      >
        <div className="card" style={{ padding: 14, minHeight: 0, overflow: 'auto' }}>
          {isMember ? (
            loading ? (
              <div className="sub">Loading…</div>
            ) : (
              <div className="fade-in">
                <div className="field">
                  <label>Membership type</label>
                  <select
                    className="select"
                    value={plan}
                    onChange={(e) => {
                      const nextPlan = e.target.value
                      setPlan(nextPlan)
                      const durations = (tillGrouped.membership || []).filter(
                        (p) => p.name === nextPlan
                      )
                      setProductId(durations.length === 1 ? String(durations[0].id) : '')
                    }}
                  >
                    <option value="">Select a membership…</option>
                    {membershipPlans.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                {plan && (
                  <div className="field fade-in">
                    <label>How long</label>
                    <select
                      className="select"
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                    >
                      <option value="">Select a duration…</option>
                      {planDurations.map((p) => (
                        <option key={p.id} value={p.id}>
                          {durationLabel(p.duration_days)} — {fmt(p.price)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {!loading && !loadError && membershipPlans.length === 0 && (
                  <p className="sub" style={{ marginTop: 6 }}>
                    No memberships are set up. Ask the owner to add one in Settings → Pricing
                    manager.
                  </p>
                )}
              </div>
            )
          ) : (
            <>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex'
                  }}
                >
                  <Icon name="search" size={16} color="#94a3b8" />
                </span>
                <input
                  className="input"
                  style={{ paddingLeft: 36 }}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={
                    tab === 'entry'
                      ? 'Search entry tickets…'
                      : tab === 'shop'
                        ? 'Search shop items…'
                        : 'Search kitchen…'
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setQ('')
                  }}
                />
              </div>

              {loading ? (
                <div className="sub">Loading…</div>
              ) : tab === 'entry' ? (
                entryItems.length === 0 ? (
                  <div className="sub">No entry tickets match.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {CART_CATEGORIES.map((c) => {
                      const items = entryItems.filter((p) => p._group === c)
                      if (!items.length) return null
                      return (
                        <div key={c}>
                          <div className="sub" style={{ marginBottom: 8, fontWeight: 500 }}>
                            {categoryLabel(c)}
                          </div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(3, 1fr)',
                              gap: 10
                            }}
                          >
                            {items.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className="card"
                                style={{
                                  padding: 12,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  border: '1px solid var(--border)'
                                }}
                                onClick={() => addOrBump(productLine(p))}
                              >
                                <div style={{ fontWeight: 500, fontSize: 13 }}>
                                  {p.displayName || p.name}
                                </div>
                                <div className="sub">{fmt(p.price)}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              ) : tab === 'shop' ? (
                shopItems.length === 0 ? (
                  <div className="sub">No shop items match.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {shopItems.map((item) => {
                      const out = item.stock <= 0
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="card"
                          disabled={out}
                          style={{
                            padding: 12,
                            textAlign: 'left',
                            cursor: out ? 'not-allowed' : 'pointer',
                            opacity: out ? 0.55 : 1,
                            border: '1px solid var(--border)'
                          }}
                          onClick={() => !out && addOrBump(poolLine(item))}
                        >
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{poolItemLabel(item)}</div>
                          <div className="sub">
                            {fmt(item.price)}
                            {out ? ' · out of stock' : ` · ${item.stock} left`}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              ) : kitchenItems.length === 0 ? (
                <div className="sub">No kitchen items match.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {kitchenItems.map((item) => {
                    const available = item.isAvailable !== false
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="card"
                        disabled={!available}
                        style={{
                          padding: 12,
                          textAlign: 'left',
                          position: 'relative',
                          cursor: available ? 'pointer' : 'not-allowed',
                          opacity: available ? 1 : 0.55,
                          border: '1px solid var(--border)'
                        }}
                        onClick={() => available && addOrBump(menuLine(item))}
                      >
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</div>
                        <div className="sub">{fmt(item.price)}</div>
                        {!available && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'grid',
                              placeItems: 'center',
                              background: 'rgba(255,255,255,0.6)',
                              borderRadius: 'inherit',
                              pointerEvents: 'none'
                            }}
                          >
                            <span className="badge b-dead">Unavailable</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="card"
          style={{ padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <div style={{ fontWeight: 500, marginBottom: 8 }}>{isMember ? 'Membership' : 'Cart'}</div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {isMember ? (
              productId ? (
                <div style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 500 }}>
                    {membershipProduct?.displayName || membershipProduct?.name}
                  </div>
                  <div className="sub" style={{ marginTop: 4 }}>
                    {durationLabel(membershipProduct?.duration_days)} · {fmt(memberTotal)}
                  </div>
                </div>
              ) : (
                <div className="sub">Choose a plan and duration</div>
              )
            ) : cart.length === 0 ? (
              <div className="sub">Tap items to add</div>
            ) : (
              cart.map((line, i) => {
                const priced = quote?.lines?.[i]
                const discount = Number(line.discount) || 0
                const reasonMissing = discount > 0 && !line.discountReason.trim()
                return (
                  <div
                    key={line.uid}
                    className="cart-line"
                    style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{line.name}</div>
                        <div className="sub" style={{ marginTop: 2 }}>
                          {priced ? `${fmt(priced.unitPrice)} each` : 'Pricing…'}
                        </div>
                      </div>
                      <QtyStepper
                        value={line.quantity}
                        min={1}
                        max={MAX_LINE_QUANTITY}
                        compact
                        disabled={saving}
                        onChange={(n) => setLineQty(line.uid, n)}
                      />
                      <div
                        style={{ minWidth: 72, textAlign: 'right', fontSize: 13, fontWeight: 500 }}
                      >
                        {priced ? fmt(priced.lineTotal) : '—'}
                      </div>
                      <button
                        className="btn btn-ghost"
                        aria-label={`Remove ${line.name}`}
                        style={{ padding: '4px 9px', fontSize: 13 }}
                        onClick={() => removeLine(line.uid)}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      {line.kind === 'product' && (
                        <div className="seg">
                          {['adult', 'child'].map((t) => (
                            <button
                              key={t}
                              className={line.tier === t ? 'on' : ''}
                              onClick={() => editLine(line.uid, { tier: t })}
                            >
                              {t === 'adult' ? 'Adult' : 'Child'}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="spacer" />
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 9px', fontSize: 12 }}
                        onClick={() =>
                          editLine(line.uid, {
                            showDiscount: !line.showDiscount,
                            ...(line.showDiscount ? { discount: '', discountReason: '' } : {})
                          })
                        }
                      >
                        <Icon name="tag" size={13} />{' '}
                        {line.showDiscount ? 'Cancel discount' : 'Discount'}
                      </button>
                    </div>
                    {line.showDiscount && (
                      <div className="fade-in" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <input
                          className="input"
                          style={{ width: 100 }}
                          type="number"
                          min="0"
                          placeholder="Rs. off"
                          value={line.discount}
                          onChange={(e) => editLine(line.uid, { discount: e.target.value })}
                        />
                        <input
                          className="input"
                          style={{ flex: 1 }}
                          placeholder="Reason for the discount"
                          value={line.discountReason}
                          onChange={(e) => editLine(line.uid, { discountReason: e.target.value })}
                        />
                      </div>
                    )}
                    {reasonMissing && (
                      <div className="sub" style={{ color: '#b91c1c', marginTop: 4 }}>
                        A reason is required before this discount can be applied.
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {!isMember &&
            (quote?.shortfalls || []).map((s) => (
              <div className="alert amber" style={{ marginTop: 8 }} key={s.name}>
                <Icon name="alert-triangle" size={17} />
                <div className="a-desc">
                  {s.name}: only {s.available} left, the basket asks for {s.needed}.
                </div>
              </div>
            ))}
          {!isMember && quoteError && (
            <div className="alert red" style={{ marginTop: 8 }}>
              <Icon name="alert-triangle" size={17} />
              <div className="a-desc">{quoteError}</div>
            </div>
          )}

          <div className="amount-box" style={{ marginTop: 10 }}>
            <span className="a-label">Due</span>
            <span className="a-value">
              {isMember
                ? productId
                  ? fmt(memberTotal)
                  : fmt(0)
                : cart.length
                  ? fmt(goodsTotal)
                  : fmt(0)}
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        {isMember ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr auto auto',
              gap: 12,
              alignItems: 'end'
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Customer name (required)</label>
              <input
                className="input"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Phone (optional)</label>
              <input
                className="input"
                value={memberPhone}
                onChange={(e) => setMemberPhone(e.target.value)}
                placeholder="98XXXXXXXX"
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#64748b',
                  marginBottom: 8
                }}
              >
                Payment
              </label>
              <div className="toggle-row">
                <button
                  className={'toggle-btn' + (pay === 'Cash' ? ' sel' : '')}
                  onClick={() => setPay('Cash')}
                >
                  <Icon name="banknote" size={17} /> Cash
                </button>
                <button
                  className={'toggle-btn' + (pay === 'QR' ? ' sel' : '')}
                  onClick={() => setPay('QR')}
                >
                  <Icon name="qr-code" size={17} /> QR
                </button>
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ minWidth: 140, alignSelf: 'end' }}
              disabled={chargeDisabled}
              onClick={handleCharge}
            >
              {saving ? 'Saving…' : 'Charge'}
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              gap: 12,
              alignItems: 'end'
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Customer</label>
              <input
                className="input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in"
              />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 140 }}>
              <label>Part pay (optional)</label>
              <input
                className="input"
                type="number"
                min="0"
                placeholder="Full amount"
                value={partAmount}
                onChange={(e) => setPartAmount(e.target.value)}
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#64748b',
                  marginBottom: 8
                }}
              >
                Payment
              </label>
              <div className="toggle-row">
                <button
                  className={'toggle-btn' + (pay === 'Cash' ? ' sel' : '')}
                  onClick={() => setPay('Cash')}
                >
                  <Icon name="banknote" size={17} /> Cash
                </button>
                <button
                  className={'toggle-btn' + (pay === 'QR' ? ' sel' : '')}
                  onClick={() => setPay('QR')}
                >
                  <Icon name="qr-code" size={17} /> QR
                </button>
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ minWidth: 140, alignSelf: 'end' }}
              disabled={chargeDisabled}
              onClick={handleCharge}
            >
              {saving ? 'Saving…' : 'Charge'}
            </button>
          </div>
        )}
        {!isMember && partAmountInvalid && (
          <div className="sub" style={{ color: '#b91c1c', marginTop: 8 }}>
            Part payment must be between Rs. 1 and {fmt(Math.max(0, goodsTotal - 0.01))}.
          </div>
        )}
        {!isMember && isPartPay && !partAmountInvalid && (
          <div className="sub" style={{ marginTop: 8 }}>
            Collecting {fmt(partPaid)} now · {fmt(balance)} remaining
          </div>
        )}
        {error && (
          <div className="alert red" style={{ marginTop: 10 }}>
            <Icon name="alert-triangle" size={17} />
            <div className="a-desc">{error}</div>
          </div>
        )}
      </div>
    </div>
  )
}
