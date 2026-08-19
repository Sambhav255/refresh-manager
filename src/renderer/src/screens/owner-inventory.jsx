import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'

// Pool stock is counted in whole units, so no decimal handling here. `delta` is
// already signed by the backend — a sale arrives negative and must stay that
// way; recomputing it from the always-positive `quantity` would hide the drop.
const signedQty = (delta) => (delta > 0 ? '+' : '') + delta

export function OwnerInventory() {
  const [inv, setInv] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    name: '',
    category: '',
    variant: '',
    reorderLevel: 5,
    sellingPrice: 0
  })
  const [restockId, setRestockId] = useState(null)
  const [restockQty, setRestockQty] = useState('')
  const [priceId, setPriceId] = useState(null)
  const [priceValue, setPriceValue] = useState('')
  const [adjustId, setAdjustId] = useState(null)
  const [adjustValue, setAdjustValue] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [historyId, setHistoryId] = useState(null)
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState('')
  const historyReq = useRef(0)

  // Each panel is its own `{id && …}` block, so two could sit open at once and
  // the owner had no way to tell which row the lower one belonged to. Every
  // opener resets the rest first, which keeps it to one panel at a time.
  const closePanels = () => {
    setShowAdd(false)
    setRestockId(null)
    setRestockQty('')
    setPriceId(null)
    setPriceValue('')
    setAdjustId(null)
    setAdjustValue('')
    setAdjustReason('')
    setHistoryId(null)
    setHistory(null)
    setHistoryLoading(false)
    // Invalidates any history lookup still in flight so its response cannot
    // repopulate a panel the owner has already navigated away from.
    historyReq.current += 1
  }

  const openAdd = () => {
    setError('')
    closePanels()
    setShowAdd(true)
  }
  // Always clear the quantity when the target item changes (and on cancel).
  // It used to be cleared only on success, so a quantity typed for one item
  // stayed in the box and could be applied to a completely different one.
  const openRestock = (item) => {
    setError('')
    closePanels()
    setRestockId(item.id)
    setRestockQty('')
  }
  const closeRestock = () => {
    setRestockId(null)
    setRestockQty('')
  }
  const openPrice = (item) => {
    setError('')
    closePanels()
    setPriceId(item.id)
    setPriceValue(String(item.price ?? 0))
  }
  const openAdjust = (item) => {
    setError('')
    closePanels()
    setAdjustId(item.id)
    setAdjustValue(String(item.stock ?? 0))
    setAdjustReason('')
  }
  const openHistory = async (item) => {
    setError('')
    closePanels()
    const req = historyReq.current
    setHistoryId(item.id)
    setHistoryLoading(true)
    const r = await api.poolItemHistory({ itemId: item.id })
    // A newer click (or any panel opened meanwhile) wins: a slower response
    // must not overwrite the panel with another item's movements.
    if (req !== historyReq.current) return
    setHistoryLoading(false)
    if (r?.success === false) {
      setError(r.error || 'Could not load item history')
      setHistoryId(null)
      return
    }
    setHistory(r)
  }
  const restockTarget = inv.find((i) => i.id === restockId)
  const priceTarget = inv.find((i) => i.id === priceId)
  const adjustTarget = inv.find((i) => i.id === adjustId)
  const historyTarget = inv.find((i) => i.id === historyId)

  const load = () => {
    api.listPoolInventory().then((r) => setInv(r.items || []))
    api.poolLowStock().then((r) => setLowStock(r.items || []))
  }

  useEffect(() => {
    load()
  }, [])

  const handleAdd = async () => {
    setError('')
    const r = await api.addPoolItem(form)
    if (r?.success === false) {
      setError(r.error || 'Could not add item')
      return
    }
    setShowAdd(false)
    setForm({ name: '', category: '', variant: '', reorderLevel: 5, sellingPrice: 0 })
    load()
  }

  const handleRestock = async () => {
    if (!restockId) return
    if (!restockQty) {
      setError('Enter a quantity to restock')
      return
    }
    setError('')
    const r = await api.restockPoolItem({ itemId: restockId, quantity: Number(restockQty) })
    if (r?.success === false) {
      setError(r.error || 'Restock failed')
      return
    }
    closeRestock()
    load()
  }

  // Restock only ever ADDS. Without this there was no way to correct stock
  // after a physical count, or to undo a mis-typed restock — the adjust handler
  // existed and was bridged, but nothing called it.
  const handleAdjust = async () => {
    if (!adjustId) return
    if (adjustValue === '') {
      setError('Enter the counted stock')
      return
    }
    if (!adjustReason.trim()) {
      setError('Give a reason for the adjustment')
      return
    }
    const r = await api.adjustPoolItem({
      itemId: adjustId,
      newQuantity: Number(adjustValue),
      reason: adjustReason.trim()
    })
    if (r?.success === false) {
      setError(r.error || 'Could not adjust stock')
      return
    }
    setError('')
    setAdjustId(null)
    setAdjustValue('')
    setAdjustReason('')
    load()
  }

  // Seeded pool items ship at selling_price 0, and Sell Item only lists items
  // priced above 0 — without an edit here the seeded stock can never be sold.
  const handleSavePrice = async () => {
    if (!priceId) return
    const r = await api.updatePoolItem({
      itemId: priceId,
      fields: { sellingPrice: Number(priceValue) }
    })
    if (r?.success === false) {
      setError(r.error || 'Could not update price')
      return
    }
    setError('')
    setPriceId(null)
    setPriceValue('')
    load()
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Pool Inventory">
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={15} /> Add item
        </button>
      </SectionHead>
      {error && (
        <div className="alert red" style={{ marginBottom: 12 }}>
          <div className="a-desc">{error}</div>
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
                .map((r) => r.item + (r.variant !== '—' ? ' (' + r.variant + ')' : ''))
                .join(' · ')}
            </div>
          </div>
        </div>
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ width: 130 }}>Variant</th>
            <th className="num" style={{ width: 80 }}>
              Stock
            </th>
            <th className="num" style={{ width: 90 }}>
              Reorder at
            </th>
            <th className="num" style={{ width: 90 }}>
              Price
            </th>
            <th style={{ width: 180 }}></th>
          </tr>
        </thead>
        <tbody>
          {inv.map((r) => (
            <tr key={r.id}>
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
              <td style={{ color: '#64748b' }}>{r.variant}</td>
              <td
                className="num"
                style={{ color: r.low ? '#ef4444' : '#1a202c', fontWeight: r.low ? 500 : 400 }}
              >
                {r.stock}
              </td>
              <td className="num" style={{ color: '#94a3b8' }}>
                {r.reorder}
              </td>
              <td className="num">
                {fmt(r.price)}
                {!(r.price > 0) && (
                  <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 6 }}>
                    not sellable
                  </span>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '5px 9px', fontSize: 12 }}
                    onClick={() => openHistory(r)}
                  >
                    History
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '5px 9px', fontSize: 12 }}
                    onClick={() => openPrice(r)}
                  >
                    Price
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '5px 9px', fontSize: 12 }}
                    onClick={() => openAdjust(r)}
                  >
                    Adjust
                  </button>
                  <button
                    className={'btn ' + (r.low ? 'btn-primary' : 'btn-ghost')}
                    style={{ padding: '5px 11px', fontSize: 12 }}
                    onClick={() => openRestock(r)}
                  >
                    Restock
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showAdd && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 10 }}>Add pool item</div>
          {['name', 'category', 'variant'].map((f) => (
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
      {restockId && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          {/* Name the item explicitly: the seed ships duplicate names (Goggles
              x3, Swimming Cap x2), so "Restock item" alone gave the owner no
              way to confirm which row the panel belongs to. */}
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            Restock {restockTarget?.item}
            {restockTarget?.variant && restockTarget.variant !== '—'
              ? ` (${restockTarget.variant})`
              : ''}
          </div>
          <div className="sub" style={{ marginBottom: 8 }}>
            Current stock: {restockTarget?.stock ?? 0}
          </div>
          <input
            className="input"
            type="number"
            value={restockQty}
            onChange={(e) => setRestockQty(e.target.value)}
            placeholder="Quantity to add"
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={handleRestock}>
              Restock
            </button>
            <button className="btn btn-ghost" onClick={closeRestock}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {adjustId && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            Adjust stock — {adjustTarget?.item}
            {adjustTarget?.variant && adjustTarget.variant !== '—'
              ? ` (${adjustTarget.variant})`
              : ''}
          </div>
          <div className="sub" style={{ marginBottom: 8 }}>
            System says {adjustTarget?.stock ?? 0}. Enter what you actually counted — the difference
            is recorded with your reason.
          </div>
          <div className="field">
            <label>Counted stock</label>
            <input
              className="input"
              type="number"
              min="0"
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
              placeholder="e.g. stock count, breakage, correction"
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAdjust}>
              Save adjustment
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setAdjustId(null)
                setAdjustValue('')
                setAdjustReason('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {priceId && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            Selling price — {priceTarget?.item}
            {priceTarget?.variant && priceTarget.variant !== '—' ? ` (${priceTarget.variant})` : ''}
          </div>
          <div className="sub" style={{ marginBottom: 8 }}>
            Items priced at 0 do not appear on the staff Sell Item screen.
          </div>
          <input
            className="input"
            type="number"
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
            placeholder="Selling price"
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={handleSavePrice}>
              Save price
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setPriceId(null)
                setPriceValue('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {historyId && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            Movement history — {history?.item?.name || historyTarget?.item}
            {history?.item?.variant ? ` (${history.item.variant})` : ''}
          </div>
          {historyLoading && <div className="sub">Loading movements…</div>}
          {!historyLoading && history && (
            <>
              <div className="sub" style={{ marginBottom: 10 }}>
                Stock on hand: {history.item?.stock ?? 0} · newest first, last{' '}
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
                      <th className="num" style={{ width: 70 }}>
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
                          style={{ color: m.delta < 0 ? '#ef4444' : '#16a34a', fontWeight: 500 }}
                        >
                          {signedQty(m.delta)}
                        </td>
                        <td className="num">{m.balance}</td>
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
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={closePanels}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
