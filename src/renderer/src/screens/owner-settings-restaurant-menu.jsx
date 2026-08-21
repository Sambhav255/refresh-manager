import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { validatePrice, validateRequired } from '../lib/validate'
import { Icon, SectionHead } from '../components/ui'

export function RestaurantMenuSettings({ back }) {
  const [items, setItems] = useState([])
  const [stockItems, setStockItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Snacks')
  const [price, setPrice] = useState('')
  const [inventoryItemId, setInventoryItemId] = useState('')
  const [error, setError] = useState('')
  // C-3: owner-side control for the same-day "mark unavailable" override —
  // separate from the permanent Active/Inactive toggle below.
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    setLoading(true)
    const r = await api.listMenuItems({ activeOnly: false })
    const inv = await api.listRestaurantInventory()
    setItems(r.items || [])
    setStockItems(inv.items || [])
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
    const r = await api.addMenuItem({
      name,
      category,
      price: Number(price),
      inventoryItemId: inventoryItemId ? Number(inventoryItemId) : null
    })
    if (r?.success === false) {
      setError(r.error || 'Could not add menu item')
      return
    }
    setName('')
    setPrice('')
    setInventoryItemId('')
    load()
  }

  const toggle = async (id, isActive) => {
    setError('')
    const r = await api.toggleMenuItem({ id, isActive: !isActive })
    if (r?.success === false) {
      setError(r.error || 'Could not update menu item')
      return
    }
    load()
  }

  // C-3: same-day "86 this item" override, auto-clears at midnight (stale
  // date reads as unset — see restaurant-menu:set-availability). Distinct
  // from `toggle` above, which is the permanent is_active retirement.
  const toggleAvailability = async (item) => {
    if (busyId) return
    setError('')
    setBusyId(item.id)
    const r = await api.setMenuItemAvailability({
      id: item.id,
      unavailable: !item.manuallyUnavailableToday
    })
    setBusyId(null)
    if (r?.success === false) {
      setError(r.error || 'Could not update availability')
      return
    }
    load()
  }

  // P0-2: change (or clear) a menu item's linked stock item. updateMenuItem is a
  // full update, so we resend the item's existing fields alongside the new link.
  const setLink = async (item, newId) => {
    setError('')
    const r = await api.updateMenuItem({
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.price,
      sortOrder: item.sort_order,
      isActive: !!item.is_active,
      inventoryItemId: newId ? Number(newId) : null
    })
    if (r?.success === false) {
      setError(r.error || 'Could not update menu item')
      return
    }
    load()
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Restaurant menu">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>

      <div className="card" style={{ padding: 14, marginBottom: 14, maxWidth: 620 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
          <select
            className="select"
            value={inventoryItemId}
            onChange={(e) => setInventoryItemId(e.target.value)}
            style={{ width: 180 }}
            title="Linked stock item (optional)"
          >
            <option value="">No linked stock</option>
            {stockItems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={add}>
            Add
          </button>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          Linking a stock item draws it down 1:1 when the item is sold at the POS.
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
        <table className="tbl" style={{ maxWidth: 720 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th className="num">Price</th>
              <th style={{ width: 190 }}>Linked stock</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 150 }}>Today</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td style={{ fontWeight: 500 }}>{i.name}</td>
                <td style={{ color: '#64748b' }}>{i.category || '—'}</td>
                <td className="num">{fmt(i.price)}</td>
                <td>
                  <select
                    className="select"
                    value={i.inventory_item_id || ''}
                    onChange={(e) => setLink(i, e.target.value)}
                    style={{ maxWidth: 180 }}
                  >
                    <option value="">— none —</option>
                    {stockItems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => toggle(i.id, i.is_active)}
                  >
                    {i.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  {/* Same-day override — a gas cylinder running out or a cook
                      calling in sick, which the stock number can't catch and
                      which shouldn't require permanently retiring the item. */}
                  <button
                    className="btn btn-ghost"
                    style={{
                      padding: '4px 8px',
                      fontSize: 11,
                      color: i.manuallyUnavailableToday ? '#b91c1c' : undefined
                    }}
                    disabled={busyId === i.id}
                    onClick={() => toggleAvailability(i)}
                  >
                    {i.manuallyUnavailableToday ? '86’d today — restore' : 'Mark unavailable today'}
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
