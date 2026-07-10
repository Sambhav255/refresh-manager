import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'

export function OwnerRestaurantInventory() {
  const [inv, setInv] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    name: '',
    category: '',
    unit: 'pcs',
    reorderLevel: 5,
    sellingPrice: 0
  })
  const [restockId, setRestockId] = useState(null)
  const [restockQty, setRestockQty] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    api.listRestaurantInventory().then((r) => setInv(r.items || []))
    api.restaurantLowStock().then((r) => setLowStock(r.items || []))
  }

  useEffect(() => {
    load()
  }, [])

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
    if (!restockId || !restockQty) return
    setError('')
    const r = await api.restockRestaurantItem({ itemId: restockId, quantity: Number(restockQty) })
    if (r?.success === false) {
      setError(r.error || 'Restock failed')
      return
    }
    setRestockId(null)
    setRestockQty('')
    load()
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Restaurant Inventory">
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
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
            <div className="a-title">{lowStock.length} items below reorder threshold</div>
            <div className="a-desc">
              {lowStock
                .slice(0, 3)
                .map((r) => r.item)
                .join(' · ')}
            </div>
          </div>
        </div>
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ width: 100 }}>Category</th>
            <th style={{ width: 70 }}>Unit</th>
            <th className="num" style={{ width: 80 }}>
              Stock
            </th>
            <th className="num" style={{ width: 90 }}>
              Reorder at
            </th>
            <th className="num" style={{ width: 90 }}>
              Price
            </th>
            <th style={{ width: 110 }}></th>
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
              <td style={{ color: '#64748b' }}>{r.category}</td>
              <td style={{ color: '#64748b' }}>{r.unit}</td>
              <td className="num" style={{ color: r.low ? '#ef4444' : '#1a202c' }}>
                {r.stock}
              </td>
              <td className="num" style={{ color: '#94a3b8' }}>
                {r.reorder}
              </td>
              <td className="num">{fmt(r.price)}</td>
              <td>
                <button
                  className={'btn ' + (r.low ? 'btn-primary' : 'btn-ghost')}
                  style={{ padding: '5px 11px', fontSize: 12 }}
                  onClick={() => setRestockId(r.id)}
                >
                  Restock
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      {restockId && (
        <div className="card" style={{ marginTop: 14, padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Restock item</div>
          <input
            className="input"
            type="number"
            value={restockQty}
            onChange={(e) => setRestockQty(e.target.value)}
            placeholder="Quantity to add"
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={handleRestock}>
              Restock
            </button>
            <button className="btn btn-ghost" onClick={() => setRestockId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
