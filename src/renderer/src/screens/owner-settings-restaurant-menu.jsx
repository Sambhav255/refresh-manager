import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { validatePrice, validateRequired } from '../lib/validate'
import { Icon, SectionHead } from '../components/ui'

export function RestaurantMenuSettings({ back }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Snacks')
  const [price, setPrice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    const r = await api.listMenuItems({ activeOnly: false })
    setItems(r.items || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    setError('')
    const nameErr = validateRequired(name, 'Name')
    const priceErr = validatePrice(price)
    if (nameErr || priceErr) {
      setError(nameErr || priceErr)
      return
    }
    await api.addMenuItem({ name, category, price: Number(price) })
    setName('')
    setPrice('')
    load()
  }

  const toggle = async (id, isActive) => {
    await api.toggleMenuItem({ id, isActive: !isActive })
    load()
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Restaurant menu">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>

      <div className="card" style={{ padding: 14, marginBottom: 14, maxWidth: 480 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
          />
          <input
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category"
            style={{ width: 120 }}
          />
          <input
            className="input"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            style={{ width: 90 }}
          />
          <button className="btn btn-primary" onClick={add}>
            Add
          </button>
        </div>
        {error && (
          <div className="sub" style={{ color: '#ef4444', marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>

      {loading ? (
        <div className="sub">Loading menu…</div>
      ) : items.length === 0 ? (
        <div className="sub">No menu items yet. Add items staff can sell at the POS.</div>
      ) : (
        <table className="tbl" style={{ maxWidth: 560 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th className="num">Price</th>
              <th style={{ width: 90 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td style={{ fontWeight: 500 }}>{i.name}</td>
                <td style={{ color: '#64748b' }}>{i.category || '—'}</td>
                <td className="num">{fmt(i.price)}</td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => toggle(i.id, i.is_active)}
                  >
                    {i.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
