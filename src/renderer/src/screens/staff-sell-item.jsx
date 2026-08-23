import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'
import { QtyStepper } from '../components/qty-stepper'

// P2-1: staff-facing sale of a pool inventory item (goggles, caps, bottled
// water, …). Amount, staff, and stock draw-down are all handled server-side in
// one atomic operation via api.sellPoolItem.
export function SellItem({ back }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [qty, setQty] = useState(1)
  const [pay, setPay] = useState('Cash')
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  const load = async () => {
    setLoading(true)
    const r = await api.listPoolInventory()
    // Only items that have a selling price can be sold.
    setItems((r.items || []).filter((i) => i.selling_price > 0))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const total = selected ? selected.selling_price * qty : 0

  const query = q.trim().toLowerCase()
  const filteredItems = query
    ? items.filter((i) => `${i.name || ''} ${i.variant || ''}`.toLowerCase().includes(query))
    : items

  const selectItem = (i) => {
    if (i.current_stock <= 0) return
    setSelected(i)
    setQty(1)
    setError('')
  }

  const confirm = async () => {
    if (!selected || saving) return
    setSaving(true)
    setError('')
    const r = await api.sellPoolItem({
      itemId: selected.id,
      quantity: qty,
      paymentMethod: pay.toLowerCase()
    })
    setSaving(false)
    if (r?.success === false) {
      setError(r.error || 'Sale failed')
      return
    }
    setDone({ item: selected, qty, total: r.total, pay })
    // Reset cleanly for the next customer.
    setSelected(null)
    setQty(1)
    setQ('')
    load()
  }

  // Enter = obvious primary action: confirm the sale (or dismiss the done
  // screen). Inputs/buttons handle their own Enter, so skip those targets.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter') return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return
      e.preventDefault()
      if (done) {
        back()
      } else if (selected) {
        confirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (done) {
    return (
      <div className="content fade-in" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card scale-in" style={{ width: 360, padding: 24, textAlign: 'center' }}>
          <Icon name="check-check" size={40} color="#0F6E56" />
          <div style={{ fontSize: 17, fontWeight: 500, marginTop: 12 }}>Item sold</div>
          <div className="sub" style={{ marginTop: 6 }}>
            {done.item.name} × {done.qty} · {fmt(done.total)} · {done.pay}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn btn-ghost btn-block" onClick={() => setDone(null)}>
              Sell another
            </button>
            <button className="btn btn-primary btn-block" onClick={back}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: '0 auto' }}>
      <SectionHead title="Sell item">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back to home
        </button>
      </SectionHead>

      {loading ? (
        <div className="sub">Loading items…</div>
      ) : items.length === 0 ? (
        <div className="sub">
          No sellable items. Ask the owner to add pool items with a selling price.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
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
                placeholder="Search items…"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQ('')
                  if (e.key === 'Enter' && filteredItems.length === 1) {
                    e.preventDefault()
                    selectItem(filteredItems[0])
                  }
                }}
              />
            </div>
            {filteredItems.length === 0 ? (
              <div className="sub" style={{ padding: '10px 2px' }}>
                No items match “{q.trim()}”.{' '}
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
                {filteredItems.map((i) => (
                  <div
                    key={i.id}
                    className={'card' + (selected?.id === i.id ? ' sel' : '')}
                    style={{
                      padding: 12,
                      cursor: i.current_stock > 0 ? 'pointer' : 'not-allowed',
                      opacity: i.current_stock > 0 ? 1 : 0.5,
                      outline: selected?.id === i.id ? '2px solid #185FA5' : 'none'
                    }}
                    title={i.current_stock > 0 ? undefined : 'Out of stock — cannot be sold'}
                    onClick={() => selectItem(i)}
                  >
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{i.name}</div>
                    <div className="sub">
                      {i.variant && i.variant !== '—' ? i.variant + ' · ' : ''}
                      {fmt(i.selling_price)}
                    </div>
                    <div
                      className="sub"
                      style={{ color: i.current_stock <= 0 || i.low ? '#ef4444' : '#94a3b8' }}
                    >
                      {i.current_stock > 0 ? `${i.current_stock} in stock` : 'Out of stock'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 500, marginBottom: 10 }}>Sale</div>
            {!selected ? (
              <div className="sub">Tap an item to sell</div>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{selected.name}</div>
                <div className="sub" style={{ marginBottom: 10 }}>
                  {fmt(selected.selling_price)} each · {selected.current_stock} in stock
                </div>
                <label style={{ fontSize: 12, color: '#64748b' }}>Quantity</label>
                <div style={{ margin: '6px 0 12px' }}>
                  <QtyStepper
                    value={qty}
                    min={1}
                    max={Math.max(1, selected.current_stock)}
                    disabled={saving}
                    onChange={setQty}
                    onEnter={confirm}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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
                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 10,
                    fontWeight: 500
                  }}
                >
                  Total: {fmt(total)}
                </div>
                {error && (
                  <div className="alert red" style={{ marginTop: 10 }}>
                    {error}
                  </div>
                )}
                <button
                  className="btn btn-primary btn-block"
                  style={{ marginTop: 12 }}
                  disabled={saving || selected.current_stock <= 0}
                  onClick={confirm}
                >
                  {saving ? 'Saving…' : 'Confirm sale'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
