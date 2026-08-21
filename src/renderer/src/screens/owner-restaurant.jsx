import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'

// Restaurant stock is measured in kg/litres, so quantities are genuinely
// fractional — round to 3dp and drop trailing zeros rather than showing whole
// units, which would report 0.5 kg of flour as "0" or "1".
const qtyText = (n) => String(Number(Number(n || 0).toFixed(3)))
// `delta` is already signed by the backend: a sale arrives negative and must
// read as a decrease. The always-positive `quantity` is deliberately unused.
const signedQty = (delta) => (Number(delta) > 0 ? '+' : '') + qtyText(delta)
// "It's kind of hard to look into the unit inventory of things and how much we
// have left." A bare number answers nothing when the unit could be kg, litres
// or plates, so stock is never printed without it.
const stockText = (item) => `${qtyText(item?.stock)} ${item?.unit || 'pcs'}`

const labelOf = (item) => (item ? item.item : '')

// Anything needing attention floats to the top — out of stock first, then at or
// below reorder level — so "what do we have left" is the first few rows rather
// than the whole table. Retired rows always sink to the bottom.
function byUrgency(a, b) {
  if (!!a.retired !== !!b.retired) return a.retired ? 1 : -1
  const rank = (i) => (i.stock <= 0 ? 0 : i.low ? 1 : 2)
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  if (rank(a) < 2 && a.stock !== b.stock) return a.stock - b.stock
  return (a.category || '').localeCompare(b.category || '') || a.item.localeCompare(b.item)
}

function StatusChip({ item }) {
  if (item.retired) return <span className="badge b-dead">Retired</span>
  if (item.stock <= 0) return <span className="badge b-dead">Out of stock</span>
  if (item.low) return <span className="badge b-exp">Low</span>
  return <span style={{ color: '#94a3b8' }}>—</span>
}

export function OwnerRestaurantInventory() {
  const [inv, setInv] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [showRetired, setShowRetired] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    name: '',
    category: '',
    unit: 'pcs',
    reorderLevel: 5,
    sellingPrice: 0
  })
  // Four buttons per row was "too much things going on". One click on the row
  // opens one panel instead, and `mode` decides which of the same four actions
  // it is showing — so the panel can only ever be about one item at a time and
  // the old cross-panel confusion is structurally impossible.
  const [panelId, setPanelId] = useState(null)
  const [mode, setMode] = useState('menu')
  const [restockQty, setRestockQty] = useState('')
  const [priceValue, setPriceValue] = useState('')
  const [adjustValue, setAdjustValue] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const historyReq = useRef(0)

  const closePanels = () => {
    setShowAdd(false)
    setPanelId(null)
    setMode('menu')
    setRestockQty('')
    setPriceValue('')
    setAdjustValue('')
    setAdjustReason('')
    setHistory(null)
    setHistoryLoading(false)
    // Invalidates any history lookup still in flight so its response cannot
    // repopulate a panel the owner has already navigated away from.
    historyReq.current += 1
  }

  const openAdd = () => {
    setError('')
    setNotice('')
    closePanels()
    setShowAdd(true)
  }
  const openItem = (item) => {
    setError('')
    setNotice('')
    // Clicking the open row again closes it, so the table is never stuck.
    if (panelId === item.id) {
      closePanels()
      return
    }
    closePanels()
    setPanelId(item.id)
    setMode('menu')
  }

  // Every action clears its own field as it opens. Values used to be cleared
  // only on success, so a quantity typed for one item stayed in the box and
  // could be applied to a completely different one.
  const openRestock = () => {
    setError('')
    setMode('restock')
    setRestockQty('')
  }
  const openPrice = (item) => {
    setError('')
    setMode('price')
    setPriceValue(String(item.price ?? 0))
  }
  const openAdjust = (item) => {
    setError('')
    setMode('adjust')
    setAdjustValue(String(item.stock ?? 0))
    setAdjustReason('')
  }
  const openHistory = async (item) => {
    setError('')
    setMode('history')
    setHistory(null)
    const req = ++historyReq.current
    setHistoryLoading(true)
    const r = await api.restaurantItemHistory({ itemId: item.id })
    // A newer click (or any panel closed meanwhile) wins: a slower response
    // must not overwrite the panel with another item's movements.
    if (req !== historyReq.current) return
    setHistoryLoading(false)
    if (r?.success === false) {
      setError(r.error || 'Could not load item history')
      setMode('menu')
      return
    }
    setHistory(r)
  }

  // Retired items are fetched too so the toggle can name how many there are —
  // and so restoring one does not need a second round trip.
  const load = () =>
    Promise.all([
      api.listRestaurantInventory({ includeRetired: true }).then((r) => setInv(r.items || [])),
      api.restaurantLowStock().then((r) => setLowStock(r.items || []))
    ])

  useEffect(() => {
    load()
  }, [])

  const retiredCount = inv.filter((i) => i.retired).length
  const visible = inv.filter((i) => showRetired || !i.retired).sort(byUrgency)
  const target = inv.find((i) => i.id === panelId)

  const handleAdd = async () => {
    setError('')
    const r = await api.addRestaurantItem(form)
    if (r?.success === false) {
      setError(r.error || 'Could not add item')
      return
    }
    setShowAdd(false)
    setForm({ name: '', category: '', unit: 'pcs', reorderLevel: 5, sellingPrice: 0 })
    load()
  }

  const handleRestock = async () => {
    if (!target) return
    if (!restockQty) {
      setError('Enter a quantity to restock')
      return
    }
    setError('')
    const r = await api.restockRestaurantItem({ itemId: target.id, quantity: Number(restockQty) })
    if (r?.success === false) {
      setError(r.error || 'Restock failed')
      return
    }
    setRestockQty('')
    setMode('menu')
    load()
  }

  const handleSavePrice = async () => {
    if (!target) return
    const r = await api.updateRestaurantItem({
      itemId: target.id,
      fields: { sellingPrice: Number(priceValue) }
    })
    if (r?.success === false) {
      setError(r.error || 'Could not update price')
      return
    }
    setError('')
    setPriceValue('')
    setMode('menu')
    load()
  }

  // Restock only adds; this is the only way to correct stock after a count.
  const handleAdjust = async () => {
    if (!target) return
    if (adjustValue === '') {
      setError('Enter the counted stock')
      return
    }
    if (!adjustReason.trim()) {
      setError('Give a reason for the adjustment')
      return
    }
    const r = await api.adjustRestaurantItem({
      itemId: target.id,
      newQuantity: Number(adjustValue),
      reason: adjustReason.trim()
    })
    if (r?.success === false) {
      setError(r.error || 'Could not adjust stock')
      return
    }
    setError('')
    setAdjustValue('')
    setAdjustReason('')
    setMode('menu')
    load()
  }

  // Retire is a soft delete: is_active 0. The item leaves the till and every
  // list, but its sales and stock movements stay on the record — a real delete
  // would rewrite past reports. `busy` stops a double-click firing it twice.
  const handleRetire = async () => {
    if (!target || busy) return
    setBusy(true)
    const label = labelOf(target)
    const r = await api.updateRestaurantItem({ itemId: target.id, fields: { isActive: 0 } })
    setBusy(false)
    if (r?.success === false) {
      setError(r.error || 'Could not retire item')
      return
    }
    setError('')
    closePanels()
    setNotice(`${label} retired. Use "Show retired" to bring it back — nothing was deleted.`)
    load()
  }

  const handleRestore = async (item) => {
    if (busy) return
    setBusy(true)
    const r = await api.updateRestaurantItem({ itemId: item.id, fields: { isActive: 1 } })
    setBusy(false)
    if (r?.success === false) {
      setError(r.error || 'Could not restore item')
      return
    }
    setError('')
    setNotice(`${labelOf(item)} is back in the list.`)
    setMode('menu')
    load()
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Restaurant Inventory">
        {retiredCount > 0 && (
          <button
            className={'btn ' + (showRetired ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setShowRetired(!showRetired)}
          >
            {showRetired ? 'Hide retired' : `Show retired (${retiredCount})`}
          </button>
        )}
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={15} /> Add item
        </button>
      </SectionHead>
      {error && (
        <div className="alert red" style={{ marginBottom: 12 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}
      {notice && (
        <div className="alert green" style={{ marginBottom: 12 }}>
          <Icon name="check" size={16} />
          <div className="a-desc">{notice}</div>
        </div>
      )}
      {lowStock.length > 0 && (
        <div className="alert red" style={{ marginBottom: 14 }}>
          <Icon name="alert-triangle" size={17} />
          <div>
            <div className="a-title">{lowStock.length} items at or below reorder level</div>
            <div className="a-desc">
              {lowStock
                .slice(0, 3)
                .map((r) => `${r.item} (${stockText(r)} left)`)
                .join(' · ')}
            </div>
          </div>
        </div>
      )}
      {inv.length === 0 ? (
        <div className="card" style={{ padding: 22, textAlign: 'center' }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>
            Nothing in the restaurant inventory yet
          </div>
          <div className="sub">
            Add only the stock you actually count — tea leaves, gas, bottled water. You can add more
            at any time.
          </div>
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Item</th>
              <th style={{ width: 100 }}>Category</th>
              <th className="num" style={{ width: 130 }}>
                In stock
              </th>
              <th className="num" style={{ width: 100 }}>
                Reorder at
              </th>
              <th className="num" style={{ width: 90 }}>
                Price
              </th>
              <th style={{ width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                onClick={() => openItem(r)}
                style={{
                  cursor: 'pointer',
                  background: panelId === r.id ? '#f1f5fb' : undefined,
                  opacity: r.retired ? 0.6 : 1
                }}
              >
                <td style={{ fontWeight: 500 }}>
                  {r.low && (
                    <Icon
                      name="alert-triangle"
                      size={14}
                      color="#ef4444"
                      style={{ verticalAlign: '-2px', marginRight: 6 }}
                    />
                  )}
                  {r.item}
                </td>
                <td style={{ color: '#64748b' }}>{r.category}</td>
                {/* The unit rides with the number: "3" means nothing when it
                    could be 3 kg, 3 litres or 3 plates. */}
                <td
                  className="num"
                  style={{ color: r.low ? '#ef4444' : '#1a202c', fontWeight: r.low ? 500 : 400 }}
                >
                  {qtyText(r.stock)}
                  <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>
                    {r.unit || 'pcs'}
                  </span>
                </td>
                <td className="num" style={{ color: 'var(--text-secondary)' }}>
                  {qtyText(r.reorder)}
                </td>
                <td className="num">{fmt(r.price)}</td>
                <td>
                  <StatusChip item={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showAdd && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 10 }}>Add restaurant item</div>
          {['name', 'category', 'unit'].map((f) => (
            <div key={f} className="field">
              <label>{f}</label>
              <input
                className="input"
                value={form[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              />
            </div>
          ))}
          <div className="field">
            <label>Reorder level</label>
            <input
              className="input"
              type="number"
              value={form.reorderLevel}
              onChange={(e) => setForm({ ...form, reorderLevel: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Selling price</label>
            <input
              className="input"
              type="number"
              value={form.sellingPrice}
              onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAdd}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {target && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div className="between" style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 500 }}>
              {labelOf(target)} {target.retired && <span className="badge b-dead">Retired</span>}
            </div>
            <button className="btn btn-ghost" onClick={closePanels}>
              Close
            </button>
          </div>
          <div className="sub" style={{ marginBottom: 12 }}>
            {stockText(target)} in stock · reorder at {qtyText(target.reorder)} {target.unit || ''}{' '}
            · {fmt(target.price)}
          </div>

          {target.retired ? (
            <div>
              <div className="sub" style={{ marginBottom: 10 }}>
                This item is off the till. Its sales and stock movements are still on record.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => handleRestore(target)}
                >
                  Restore item
                </button>
                <button className="btn btn-ghost" onClick={() => openHistory(target)}>
                  History
                </button>
              </div>
            </div>
          ) : (
            <div className="seg" style={{ marginBottom: 14 }}>
              <button className={mode === 'restock' ? 'on' : ''} onClick={openRestock}>
                Restock
              </button>
              <button className={mode === 'adjust' ? 'on' : ''} onClick={() => openAdjust(target)}>
                Adjust stock
              </button>
              <button className={mode === 'price' ? 'on' : ''} onClick={() => openPrice(target)}>
                Price
              </button>
              <button
                className={mode === 'history' ? 'on' : ''}
                onClick={() => openHistory(target)}
              >
                History
              </button>
              <button
                className={mode === 'retire' ? 'on' : ''}
                style={{ color: '#b91c1c' }}
                onClick={() => {
                  setError('')
                  setMode('retire')
                }}
              >
                Retire
              </button>
            </div>
          )}

          {mode === 'restock' && (
            <div>
              <div className="field">
                <label>Quantity to add ({target.unit || 'pcs'})</label>
                <input
                  className="input"
                  type="number"
                  value={restockQty}
                  onChange={(e) => setRestockQty(e.target.value)}
                  placeholder="Quantity to add"
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleRestock}>
                  Restock
                </button>
                <button className="btn btn-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'adjust' && (
            <div>
              <div className="sub" style={{ marginBottom: 8 }}>
                System says {stockText(target)}. Enter what you actually counted — the difference is
                recorded with your reason.
              </div>
              <div className="field">
                <label>Counted stock ({target.unit || 'pcs'})</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="any"
                  value={adjustValue}
                  onChange={(e) => setAdjustValue(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Reason</label>
                <input
                  className="input"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. stock count, spoilage, correction"
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleAdjust}>
                  Save adjustment
                </button>
                <button className="btn btn-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'price' && (
            <div>
              <div className="field">
                <label>Selling price</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleSavePrice}>
                  Save price
                </button>
                <button className="btn btn-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Retiring stock that is worth money should never be silent, so the
              confirmation says exactly what is on the shelf. */}
          {mode === 'retire' && (
            <div>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Retire {labelOf(target)}?</div>
              <div className="sub" style={{ marginBottom: 6 }}>
                It stops appearing on the till; history is kept. Nothing is deleted — you can
                restore it from “Show retired” at any time.
              </div>
              {target.stock > 0 && (
                <div className="sub" style={{ marginBottom: 6, color: '#b45309' }}>
                  This item still has {stockText(target)} on hand. That stock stays recorded but
                  cannot be sold — any menu item linked to it will stop selling too.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className="btn"
                  style={{ background: '#dc2626', color: '#fff' }}
                  disabled={busy}
                  onClick={handleRetire}
                >
                  Retire item
                </button>
                <button className="btn btn-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'history' && (
            <div>
              {historyLoading && <div className="sub">Loading movements…</div>}
              {!historyLoading && history && (
                <>
                  <div className="sub" style={{ marginBottom: 10 }}>
                    Stock on hand: {qtyText(history.item?.stock)}
                    {history.item?.unit ? ' ' + history.item.unit : ''} · newest first, last{' '}
                    {history.movements.length} movement
                    {history.movements.length === 1 ? '' : 's'}
                  </div>
                  {history.movements.length === 0 ? (
                    <div className="sub">No movements recorded for this item yet.</div>
                  ) : (
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th style={{ width: 140 }}>When</th>
                          <th style={{ width: 100 }}>Movement</th>
                          <th className="num" style={{ width: 80 }}>
                            Qty
                          </th>
                          <th className="num" style={{ width: 80 }}>
                            Balance
                          </th>
                          <th>Details</th>
                          <th style={{ width: 130 }}>By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.movements.map((m) => (
                          <tr key={m.id}>
                            {/* `at` is already local 'YYYY-MM-DD HH:MM:SS'; trimming
                                the seconds beats re-parsing it into a Date. */}
                            <td style={{ color: '#64748b' }}>{m.at.slice(0, 16)}</td>
                            <td>{m.label}</td>
                            <td
                              className="num"
                              style={{
                                color: m.delta < 0 ? '#ef4444' : '#16a34a',
                                fontWeight: 500
                              }}
                            >
                              {signedQty(m.delta)}
                            </td>
                            <td className="num">{qtyText(m.balance)}</td>
                            <td style={{ color: '#64748b' }}>
                              {m.reason || ''}
                              {m.transactionId && (
                                <span style={{ marginLeft: m.reason ? 6 : 0 }}>
                                  {m.customerName || 'Walk-in'} · {fmt(m.transactionAmount)}
                                </span>
                              )}
                              {!m.reason && !m.transactionId && '—'}
                            </td>
                            <td style={{ color: '#64748b' }}>{m.staffName || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
