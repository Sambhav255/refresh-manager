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
  // Admin accounts (there can be several; at least one must stay active)
  const [admins, setAdmins] = useState([])
  const [meId, setMeId] = useState(null)
  const [adminName, setAdminName] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminConfirm, setAdminConfirm] = useState('')
  const [adminError, setAdminError] = useState('')
  const [confirmDeactivateId, setConfirmDeactivateId] = useState(null)
  const [confirmStaffDeactivateId, setConfirmStaffDeactivateId] = useState(null)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState(null)

  const load = () => {
    api.listStaff().then((r) => setStaff(r.users || []))
    api.listAdmins().then((r) => setAdmins(r.users || []))
    api.getSession().then((u) => setMeId(u?.userId ?? null))
  }
  useEffect(() => {
    load()
  }, [])

  const addAdmin = async () => {
    setAdminError('')
    if (!adminName.trim()) {
      setAdminError('Name is required')
      return
    }
    if ((adminPassword || '').length < 4) {
      setAdminError('Password must be at least 4 characters')
      return
    }
    if (adminPassword !== adminConfirm) {
      setAdminError('Passwords do not match')
      return
    }
    const r = await api.addAdmin({ name: adminName.trim(), password: adminPassword })
    if (r?.success === false) {
      setAdminError(r.error || 'Failed to add admin')
      return
    }
    setAdminName('')
    setAdminPassword('')
    setAdminConfirm('')
    load()
  }

  const deactivateAdmin = async (id) => {
    setAdminError('')
    const r = await api.deactivateAdmin({ userId: id })
    setConfirmDeactivateId(null)
    if (r?.success === false) {
      setAdminError(r.error || 'Failed to deactivate admin')
      return
    }
    load()
  }

  const changeMyPassword = async () => {
    setPwMsg(null)
    if ((pwNew || '').length < 4) {
      setPwMsg({ ok: false, text: 'New password must be at least 4 characters' })
      return
    }
    if (pwNew !== pwConfirm) {
      setPwMsg({ ok: false, text: 'New passwords do not match' })
      return
    }
    const r = await api.changeAdminPassword({ currentPassword: pwCurrent, newPassword: pwNew })
    if (r?.success === false) {
      setPwMsg({ ok: false, text: r.error || 'Failed to change password' })
      return
    }
    setPwCurrent('')
    setPwNew('')
    setPwConfirm('')
    setPwMsg({ ok: true, text: 'Password changed.' })
  }

  const add = async () => {
    setError('')
    const pinErr = validatePin(pin)
    if (pinErr) {
      setError(pinErr)
      return
    }
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    const r = await api.addStaff({ name: name.trim(), pin })
    if (r?.success === false) {
      setError(r.error || 'Failed to add staff')
      return
    }
    setName('')
    setPin('')
    load()
  }

  const deactivate = async (id) => {
    setError('')
    const r = await api.deactivateUser({ userId: id })
    setConfirmStaffDeactivateId(null)
    if (r?.success === false) {
      setError(r.error || 'Failed to deactivate staff member')
      return
    }
    load()
  }

  const changePin = async () => {
    setError('')
    const pinErr = validatePin(newPin)
    if (pinErr) {
      setError(pinErr)
      return
    }
    const r = await api.changePin({ userId: changeId, newPin })
    if (r?.success === false) {
      setError(r.error || 'Failed to change PIN')
      return
    }
    setChangeId(null)
    setNewPin('')
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Staff & Admins">
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
                {s.is_active &&
                  (confirmStaffDeactivateId === s.id ? (
                    <>
                      <span className="sub" style={{ marginRight: 6 }}>
                        Deactivate {s.name}?
                      </span>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11, color: '#dc2626' }}
                        onClick={() => deactivate(s.id)}
                      >
                        Yes, deactivate
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => setConfirmStaffDeactivateId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
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
                        onClick={() => setConfirmStaffDeactivateId(s.id)}
                      >
                        Deactivate
                      </button>
                    </>
                  ))}
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

      <div className="h1" style={{ marginTop: 26, marginBottom: 18 }}>
        Admin accounts
      </div>
      {adminError && (
        <div className="alert red" style={{ marginBottom: 12 }}>
          <div className="a-desc">{adminError}</div>
        </div>
      )}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>Add admin</div>
        <div className="sub" style={{ marginBottom: 8 }}>
          Admins sign in with their name and password and have full access, including refunds,
          backups, and settings.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="Name"
            style={{ minWidth: 160 }}
          />
          <input
            className="input"
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="Password"
            style={{ minWidth: 140 }}
          />
          <input
            className="input"
            type="password"
            value={adminConfirm}
            onChange={(e) => setAdminConfirm(e.target.value)}
            placeholder="Confirm password"
            style={{ minWidth: 140 }}
          />
          <button className="btn btn-primary" onClick={addAdmin}>
            Add
          </button>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: 100 }}>Status</th>
            <th style={{ width: 220 }}></th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.id}>
              <td style={{ fontWeight: 500 }}>
                {a.name}
                {a.id === meId && (
                  <span className="sub" style={{ marginLeft: 6 }}>
                    (you)
                  </span>
                )}
              </td>
              <td style={{ color: a.is_active ? '#16a34a' : '#94a3b8' }}>
                {a.is_active ? 'Active' : 'Inactive'}
              </td>
              <td>
                {a.is_active === 1 &&
                  a.id !== meId &&
                  (confirmDeactivateId === a.id ? (
                    <>
                      <span className="sub" style={{ marginRight: 6 }}>
                        Deactivate {a.name}?
                      </span>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11, color: '#dc2626' }}
                        onClick={() => deactivateAdmin(a.id)}
                      >
                        Yes, deactivate
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => setConfirmDeactivateId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => setConfirmDeactivateId(a.id)}
                    >
                      Deactivate
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 14, padding: 14 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>Change my password</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="password"
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            placeholder="Current password"
            style={{ minWidth: 150 }}
          />
          <input
            className="input"
            type="password"
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            placeholder="New password"
            style={{ minWidth: 140 }}
          />
          <input
            className="input"
            type="password"
            value={pwConfirm}
            onChange={(e) => setPwConfirm(e.target.value)}
            placeholder="Confirm new password"
            style={{ minWidth: 150 }}
          />
          <button className="btn btn-primary" onClick={changeMyPassword}>
            Change password
          </button>
        </div>
        {pwMsg && (
          <div className={'alert ' + (pwMsg.ok ? 'green' : 'red')} style={{ marginTop: 10 }}>
            <div className="a-desc">{pwMsg.text}</div>
          </div>
        )}
      </div>
    </div>
  )
}
