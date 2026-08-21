import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'

// Pool stock is counted in whole units, so no decimal handling here. `delta` is
// already signed by the backend — a sale arrives negative and must stay that
// way; recomputing it from the always-positive `quantity` would hide the drop.
const signedQty = (delta) => (delta > 0 ? '+' : '') + delta

// The list maps a missing variant to '—' for the table; anywhere it is used in
// a sentence that placeholder has to disappear again.
const variantOf = (item) => (item?.variant && item.variant !== '—' ? item.variant : '')
const labelOf = (item) => (item ? item.item + (variantOf(item) ? ` (${variantOf(item)})` : '') : '')

// "It's kind of hard to look into the unit inventory of things and how much we
// have left." Anything needing attention floats to the top — out of stock
// first, then at or below reorder level — so the answer is the first few rows
// rather than the whole table. Retired rows always sink to the bottom.
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
  // H-32: the em-dash fallback only fired for a healthy item — no "in stock
  // and fine" chip existed, so every row reading em-dash was mistaken for
  // "status is broken" rather than "everything here is fine." b-active is
  // the same green Badge (ui.jsx) maps 'In stock' to; used directly since
  // this file keeps its own tiny local StatusChip rather than the shared
  // component (see task-3-brief.md Part C).
  return <span className="badge b-active">In stock</span>
}

export function OwnerInventory() {
  const [inv, setInv] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [showRetired, setShowRetired] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    name: '',
    category: '',
    variant: '',
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
    const r = await api.poolItemHistory({ itemId: item.id })
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
      api.listPoolInventory({ includeRetired: true }).then((r) => setInv(r.items || [])),
      api.poolLowStock().then((r) => setLowStock(r.items || []))
    ])

  useEffect(() => {
    load()
  }, [])

  const retiredCount = inv.filter((i) => i.retired).length
  const visible = inv.filter((i) => showRetired || !i.retired).sort(byUrgency)
  const target = inv.find((i) => i.id === panelId)

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
    if (!target) return
    if (!restockQty) {
      setError('Enter a quantity to restock')
      return
    }
    setError('')
    const r = await api.restockPoolItem({ itemId: target.id, quantity: Number(restockQty) })
    if (r?.success === false) {
      setError(r.error || 'Restock failed')
      return
    }
    setRestockQty('')
    setMode('menu')
    load()
  }

  // Restock only ever ADDS. Without this there was no way to correct stock
  // after a physical count, or to undo a mis-typed restock.
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
    const r = await api.adjustPoolItem({
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

  // Sell Item only lists items priced above 0, so an unpriced item can never
  // be sold — this is where that gets fixed.
  const handleSavePrice = async () => {
    if (!target) return
    const r = await api.updatePoolItem({
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

  // Retire is a soft delete: is_active 0. The item leaves the till and every
  // list, but its sales and stock movements stay on the record — a real delete
  // would rewrite past reports. `busy` stops a double-click firing it twice.
  const handleRetire = async () => {
    if (!target || busy) return
    setBusy(true)
    const label = labelOf(target)
    const r = await api.updatePoolItem({ itemId: target.id, fields: { isActive: 0 } })
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
    const r = await api.updatePoolItem({ itemId: item.id, fields: { isActive: 1 } })
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
      <SectionHead title="Pool Inventory">
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
                .map((r) => r.item + (r.variant !== '—' ? ' (' + r.variant + ')' : ''))
                .join(' · ')}
            </div>
          </div>
        </div>
      )}
      {inv.length === 0 ? (
        <div className="card" style={{ padding: 22, textAlign: 'center' }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>Nothing in the pool inventory yet</div>
          <div className="sub">
            Add only the items you actually sell — goggles, caps, costumes. You can add more at any
            time.
          </div>
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Item</th>
              <th style={{ width: 130 }}>Variant</th>
              <th className="num" style={{ width: 110 }}>
                In stock
              </th>
              <th className="num" style={{ width: 90 }}>
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
                <td style={{ color: '#64748b' }}>{r.variant}</td>
                <td
                  className="num"
                  style={{ color: r.low ? '#ef4444' : '#1a202c', fontWeight: r.low ? 500 : 400 }}
                >
                  {r.stock}
                  <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 4 }}>pcs</span>
                </td>
                <td className="num" style={{ color: 'var(--text-secondary)' }}>
                  {r.reorder}
                </td>
                <td className="num">
                  {fmt(r.price)}
                  {!(r.price > 0) && !r.retired && (
                    <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 6 }}>
                      not sellable
                    </span>
                  )}
                </td>
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
      {target && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          {/* Name the item explicitly: duplicate names are normal here (Goggles
              in three sizes), so the panel has to say which row it belongs to. */}
          <div className="between" style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 500 }}>
              {labelOf(target)} {target.retired && <span className="badge b-dead">Retired</span>}
            </div>
            <button className="btn btn-ghost" onClick={closePanels}>
              Close
            </button>
          </div>
          <div className="sub" style={{ marginBottom: 12 }}>
            {target.stock} pcs in stock · reorder at {target.reorder} · {fmt(target.price)}
            {!(target.price > 0) && !target.retired && ' — priced at 0, so staff cannot sell it'}
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
                <label>Quantity to add</label>
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
                System says {target.stock}. Enter what you actually counted — the difference is
                recorded with your reason.
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
                <button className="btn btn-ghost" onClick={() => setMode('menu')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'price' && (
            <div>
              <div className="sub" style={{ marginBottom: 8 }}>
                Items priced at 0 do not appear on the staff Sell Item screen.
              </div>
              <div className="field">
                <label>Selling price</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  placeholder="Selling price"
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
                  This item still has {target.stock} pcs on hand. That stock stays recorded but
                  cannot be sold while the item is retired.
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
                    Stock on hand: {history.item?.stock ?? 0} pcs · newest first, last{' '}
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
                              style={{
                                color: m.delta < 0 ? '#ef4444' : '#16a34a',
                                fontWeight: 500
                              }}
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
