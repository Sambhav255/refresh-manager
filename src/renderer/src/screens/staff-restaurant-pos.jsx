import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'

const MAX_QTY = 999

// Hoisted to module scope so cart rows don't remount (losing input focus) on
// every parent render. Supports both tap (+/−) and direct typing, clamped to
// [min, max]. When min is 0, stepping/typing down to 0 lets the parent remove
// the row (existing cart behavior).
function QtyStepper({ value, min = 1, max = MAX_QTY, disabled, onChange, onEnter }) {
  const [text, setText] = useState(String(value))
  // Resync the draft text when the committed value changes from outside
  // (recommended adjust-state-during-render pattern, no effect needed).
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(String(value))
  }
  const clamp = (n) => Math.max(min, Math.min(max, n))
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button
        className="btn btn-ghost"
        style={{ padding: '2px 8px' }}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <input
        className="input"
        style={{ width: 46, padding: '3px 4px', textAlign: 'center' }}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, '')
          setText(raw)
          if (raw === '') return
          const n = clamp(parseInt(raw, 10))
          if (String(n) !== raw) setText(String(n))
          onChange(n)
        }}
        onBlur={() => setText(String(value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
      />
      <button
        className="btn btn-ghost"
        style={{ padding: '2px 8px' }}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  )
}

export function StaffRestaurantPos({ session, back }) {
  const [menu, setMenu] = useState([])
  const [cart, setCart] = useState([])
  const [pay, setPay] = useState('Cash')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // C-3: staff-side manual "mark unavailable for today" affordance. No
  // long-press gesture exists anywhere else in this touch/mouse-hybrid app
  // (checked before assuming one — App.jsx's only touch listener is an
  // idle-timeout tracker, not a gesture), so this reuses the exact
  // .rowmenu + fixed-position overflow-menu pattern Task 6/C-8 and C-7
  // already established in owner-transactions.jsx/owner-members.jsx —
  // same data-rowmenu marker, same outside-click/Escape/scroll close below
  // — rather than inventing a new interaction just for this tile.
  const [menuOpenId, setMenuOpenId] = useState(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    api.listMenuItems().then((r) => {
      setMenu(r.items || [])
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (menuOpenId == null) return
    const onDocClick = (e) => {
      if (!e.target.closest('[data-rowmenu]')) setMenuOpenId(null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpenId(null)
    }
    const onScroll = () => setMenuOpenId(null)
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuOpenId])

  // Flips the same-day override and reflects it in the tile immediately —
  // no page reload, no re-fetch of the whole menu. isAvailable is
  // recomputed the same way the backend does (stock-ok AND not manually
  // unavailable today) so a zero-stock item stays greyed out even after
  // "Mark available" clears the override.
  const toggleAvailability = async (item) => {
    if (busyId) return
    const unavailable = !item.manuallyUnavailableToday
    setBusyId(item.id)
    const r = await api.setMenuItemAvailability({ id: item.id, unavailable })
    setBusyId(null)
    setMenuOpenId(null)
    if (r?.success === false) {
      setError(r.error || 'Could not update availability')
      return
    }
    setError('')
    setMenu((prev) =>
      prev.map((m) =>
        m.id === item.id
          ? {
              ...m,
              manuallyUnavailableToday: unavailable,
              isAvailable: !unavailable && (m.currentStock == null || m.currentStock > 0)
            }
          : m
      )
    )
  }

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id)
      if (existing) {
        return prev.map((c) =>
          c.id === item.id ? { ...c, quantity: Math.min(MAX_QTY, c.quantity + 1) } : c
        )
      }
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  const updateQty = (id, quantity) => {
    setCart((prev) =>
      prev.map((c) => (c.id === id ? { ...c, quantity } : c)).filter((c) => c.quantity > 0)
    )
  }

  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0)

  const query = q.trim().toLowerCase()
  const filteredMenu = query
    ? menu.filter((m) => (m.name || '').toLowerCase().includes(query))
    : menu

  const checkout = async () => {
    if (!cart.length || saving) return
    setSaving(true)
    setError('')
    const r = await api.restaurantCheckout({
      // The handler resolves each line by id and re-derives the price from the
      // catalogue — id is the field it keys on, so it must be sent.
      items: cart.map((c) => ({ id: c.id, quantity: c.quantity })),
      paymentMethod: pay.toLowerCase(),
      staffId: session?.userId
    })
    setSaving(false)
    if (r?.success === false) {
      // Internal lookup failures read as data problems at the till; say what
      // the person on the counter should actually do.
      const raw = r.error || 'Checkout failed'
      setError(
        /not found/i.test(raw)
          ? 'That item is no longer on the menu. Go back and rebuild the order.'
          : raw
      )
      return
    }
    setDone(true)
    // Reset cleanly for the next customer.
    setCart([])
    setPay('Cash')
    setQ('')
  }

  // Enter = obvious primary action: confirm the order (or dismiss the done
  // screen). Inputs/buttons handle their own Enter, so skip those targets.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter') return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return
      e.preventDefault()
      if (done) {
        setDone(false)
        back()
      } else {
        checkout()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (done) {
    return (
      <div
        className="content fade-in"
        style={{ display: 'grid', placeItems: 'center', paddingTop: 40 }}
      >
        <div className="card scale-in" style={{ width: 360, padding: 24, textAlign: 'center' }}>
          <Icon name="check-check" size={40} color="#0F6E56" />
          <div style={{ fontSize: 18, fontWeight: 500, marginTop: 12 }}>Order saved</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost btn-block" onClick={() => setDone(false)}>
              New order
            </button>
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                setDone(false)
                back()
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Restaurant POS">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>

      {loading ? (
        <div className="sub">Loading menu…</div>
      ) : menu.length === 0 ? (
        <div className="sub">
          No menu items configured. Ask the owner to set up the restaurant menu.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
          <div>
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
                placeholder="Search menu…"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQ('')
                  if (
                    e.key === 'Enter' &&
                    filteredMenu.length === 1 &&
                    filteredMenu[0].isAvailable
                  ) {
                    e.preventDefault()
                    addToCart(filteredMenu[0])
                  }
                }}
              />
            </div>
            {filteredMenu.length === 0 ? (
              <div className="sub" style={{ padding: '10px 2px' }}>
                No menu items match “{q.trim()}”.{' '}
                <button
                  className="btn btn-ghost"
                  style={{ padding: '2px 8px' }}
                  onClick={() => setQ('')}
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {filteredMenu.map((item) => {
                  // Part A: greyed out and un-clickable at zero (or manually
                  // 86'd) stock — the tile's onClick is gated below, not just
                  // its styling, so a disabled-looking tile can't still add to
                  // cart. A low-but-nonzero item stays fully sellable and only
                  // gets a warning dot (reusing owner-inventory/owner-
                  // restaurant's existing low-stock amber, not a new colour).
                  const available = item.isAvailable !== false
                  const showLowDot = available && item.isLowStock
                  return (
                    <div
                      key={item.id}
                      className="card"
                      style={{
                        padding: 12,
                        position: 'relative',
                        cursor: available ? 'pointer' : 'not-allowed',
                        opacity: available ? 1 : 0.55
                      }}
                      onClick={() => {
                        if (available) addToCart(item)
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 4
                        }}
                      >
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {showLowDot && (
                            <span
                              title="Low stock"
                              style={{
                                display: 'inline-block',
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                background: 'var(--badge-exp-tx)',
                                marginRight: 6,
                                verticalAlign: 'middle'
                              }}
                            />
                          )}
                          {item.name}
                        </div>
                        <div
                          data-rowmenu
                          style={{ position: 'relative', zIndex: 2 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="rowmenu"
                            style={{ width: 24, height: 24 }}
                            aria-label={`More actions for ${item.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              const next = menuOpenId === item.id ? null : item.id
                              if (next) {
                                const r = e.currentTarget.getBoundingClientRect()
                                setMenuPos({ top: r.bottom + 4, left: r.right - 200 })
                              }
                              setMenuOpenId(next)
                            }}
                          >
                            <Icon name="more-vertical" size={14} />
                          </button>
                          {menuOpenId === item.id && (
                            <div
                              data-rowmenu
                              className="card"
                              style={{
                                position: 'fixed',
                                top: menuPos.top,
                                left: menuPos.left,
                                zIndex: 1000,
                                padding: 4,
                                minWidth: 200,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2
                              }}
                            >
                              <button
                                className="btn btn-ghost"
                                style={{
                                  justifyContent: 'flex-start',
                                  minHeight: 36,
                                  fontSize: 12.5
                                }}
                                disabled={busyId === item.id}
                                onClick={() => toggleAvailability(item)}
                              >
                                {item.manuallyUnavailableToday
                                  ? 'Mark available'
                                  : 'Mark unavailable for today'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="sub">{fmt(item.price)}</div>
                      {!available && (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 1,
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
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 500, marginBottom: 10 }}>Cart</div>
            {cart.length === 0 ? (
              <div className="sub">Tap items to add</div>
            ) : (
              cart.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    fontSize: 13
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {c.name}
                  </span>
                  <QtyStepper
                    value={c.quantity}
                    min={0}
                    max={MAX_QTY}
                    disabled={saving}
                    onChange={(n) => updateQty(c.id, n)}
                    onEnter={checkout}
                  />
                </div>
              ))
            )}
            <div
              style={{
                borderTop: '1px solid var(--border)',
                marginTop: 10,
                paddingTop: 10,
                fontWeight: 500
              }}
            >
              Total: {fmt(total)}
            </div>
            {cart.length > 0 && (
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 8 }}
                disabled={saving}
                onClick={() => {
                  setCart([])
                  setError('')
                }}
              >
                <Icon name="x" size={14} /> Clear order
              </button>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {['Cash', 'QR'].map((p) => (
                <button
                  key={p}
                  className={'btn ' + (pay === p ? 'btn-primary' : 'btn-ghost')}
                  style={{ flex: 1 }}
                  disabled={saving}
                  onClick={() => setPay(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            {error && (
              <div className="alert red" style={{ marginTop: 10 }}>
                {error}
              </div>
            )}
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              disabled={!cart.length || saving}
              onClick={checkout}
            >
              {saving ? 'Saving…' : 'Confirm order'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
