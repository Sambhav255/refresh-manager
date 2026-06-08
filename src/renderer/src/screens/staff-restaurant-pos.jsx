import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'

export function StaffRestaurantPos({ session, back }) {
  const [menu, setMenu] = useState([])
  const [cart, setCart] = useState([])
  const [pay, setPay] = useState('Cash')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listMenuItems().then((r) => {
      setMenu(r.items || [])
      setLoading(false)
    })
  }, [])

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id)
      if (existing) {
        return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c))
      }
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  const adjustQty = (id, delta) => {
    setCart((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    )
  }

  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0)

  const checkout = async () => {
    if (!cart.length) return
    setSaving(true)
    setError('')
    const r = await api.restaurantCheckout({
      items: cart.map((c) => ({ name: c.name, price: c.price, quantity: c.quantity })),
      paymentMethod: pay.toLowerCase(),
      staffId: session?.userId
    })
    setSaving(false)
    if (r?.success === false) {
      setError(r.error || 'Checkout failed')
      return
    }
    setDone(true)
    setCart([])
  }

  if (done) {
    return (
      <div
        className="content fade-in"
        style={{ display: 'grid', placeItems: 'center', paddingTop: 40 }}
      >
        <div className="card scale-in" style={{ width: 360, padding: 24, textAlign: 'center' }}>
          <Icon name="check-check" size={40} color="#0F6E56" />
          <div style={{ fontSize: 18, fontWeight: 500, marginTop: 12 }}>Order saved</div>
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 16 }}
            onClick={() => {
              setDone(false)
              back()
            }}
          >
            Done
          </button>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {menu.map((item) => (
              <div
                key={item.id}
                className="card"
                style={{ padding: 12, cursor: 'pointer' }}
                onClick={() => addToCart(item)}
              >
                <div style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</div>
                <div className="sub">{fmt(item.price)}</div>
              </div>
            ))}
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
                    padding: '6px 0',
                    fontSize: 13
                  }}
                >
                  <span>{c.name}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px' }}
                      onClick={() => adjustQty(c.id, -1)}
                    >
                      −
                    </button>
                    <span>{c.quantity}</span>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px' }}
                      onClick={() => adjustQty(c.id, 1)}
                    >
                      +
                    </button>
                  </div>
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
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {['Cash', 'QR'].map((p) => (
                <button
                  key={p}
                  className={'btn ' + (pay === p ? 'btn-primary' : 'btn-ghost')}
                  style={{ flex: 1 }}
                  onClick={() => setPay(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            {error && (
              <div className="sub" style={{ color: '#ef4444', marginTop: 8 }}>
                {error}
              </div>
            )}
            <button
              className="btn btn-teal btn-block"
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
