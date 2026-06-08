import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { validatePin } from '../lib/validate'
import { Icon, SectionHead } from '../components/ui'

export function ManageStaff({ back }) {
  const [staff, setStaff] = useState([])
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [changeId, setChangeId] = useState(null)
  const [newPin, setNewPin] = useState('')
  const [error, setError] = useState('')

  const load = () => api.listStaff().then((r) => setStaff(r.users || []))
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    setError('')
    const pinErr = validatePin(pin)
    if (pinErr) { setError(pinErr); return }
    if (!name.trim()) { setError('Name is required'); return }
    const r = await api.addStaff({ name: name.trim(), pin })
    if (r?.success === false) { setError(r.error || 'Failed to add staff'); return }
    setName('')
    setPin('')
    load()
  }

  const deactivate = async (id) => {
    await api.deactivateUser({ userId: id })
    load()
  }

  const changePin = async () => {
    setError('')
    const pinErr = validatePin(newPin)
    if (pinErr) { setError(pinErr); return }
    const r = await api.changePin({ userId: changeId, newPin })
    if (r?.success === false) { setError(r.error || 'Failed to change PIN'); return }
    setChangeId(null)
    setNewPin('')
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Staff PINs">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>
      {error && (
        <div className="alert red" style={{ marginBottom: 12 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>Add staff</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            className="input"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4-digit PIN"
            maxLength={4}
            style={{ width: 120 }}
          />
          <button className="btn btn-primary" onClick={add}>
            Add
          </button>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: 100 }}>Status</th>
            <th style={{ width: 200 }}></th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 500 }}>{s.name}</td>
              <td style={{ color: s.is_active ? '#16a34a' : '#94a3b8' }}>
                {s.is_active ? 'Active' : 'Inactive'}
              </td>
              <td>
                {s.is_active && (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => setChangeId(s.id)}
                    >
                      Change PIN
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => deactivate(s.id)}
                    >
                      Deactivate
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {changeId && (
        <div className="card" style={{ marginTop: 14, padding: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>New PIN</div>
          <input
            className="input"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            maxLength={4}
            placeholder="4-digit PIN"
            style={{ width: 140 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={changePin}>
              Save PIN
            </button>
            <button className="btn btn-ghost" onClick={() => setChangeId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
