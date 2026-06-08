import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { Icon, SectionHead } from '../components/ui'

export function PricingManager({ back }) {
  const [products, setProducts] = useState([])
  const [historyId, setHistoryId] = useState(null)
  const [history, setHistory] = useState([])
  const [editId, setEditId] = useState(null)
  const [newPrice, setNewPrice] = useState('')

  const load = () =>
    api.listProducts({ activeOnly: false }).then((r) => setProducts(r.products || []))
  useEffect(() => {
    load()
  }, [])

  const savePrice = async (id) => {
    await api.updatePrice({ productId: id, newPrice: Number(newPrice) })
    setEditId(null)
    setNewPrice('')
    load()
  }

  const showHistory = async (id) => {
    setHistoryId(id)
    const r = await api.priceHistory({ productId: id })
    setHistory(r.history || [])
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Pricing manager">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>
      <table className="tbl">
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th className="num" style={{ width: 120 }}>
              Price
            </th>
            <th style={{ width: 160 }}></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td style={{ fontWeight: 500 }}>{p.displayName || p.name}</td>
              <td style={{ color: '#64748b' }}>{p.category}</td>
              <td className="num">
                {editId === p.id ? (
                  <input
                    className="input"
                    type="number"
                    style={{ width: 90 }}
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                  />
                ) : (
                  fmt(p.price)
                )}
              </td>
              <td>
                {editId === p.id ? (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => savePrice(p.id)}
                  >
                    Save
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => {
                        setEditId(p.id)
                        setNewPrice(String(p.price))
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => showHistory(p.id)}
                    >
                      History
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {historyId && (
        <div className="card" style={{ marginTop: 14, padding: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Price history</div>
          {history.map((h) => (
            <div
              key={h.id}
              style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}
            >
              {fmt(h.old_price)} → {fmt(h.new_price)} by {h.changed_by_name} · {h.changed_at}
            </div>
          ))}
          <button
            className="btn btn-ghost"
            style={{ marginTop: 8 }}
            onClick={() => setHistoryId(null)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
