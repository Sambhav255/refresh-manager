import { useState, useEffect, useRef, useCallback } from 'react'
import { Window, WaveMark, Icon, AppHeader, SectionHead } from './components/ui'
import { ScreenErrorBoundary } from './components/ScreenErrorBoundary'
import { api } from './lib/api'
import {
  STAFF_TILES,
  StaffHome,
  NewTransaction,
  MemberSearch,
  TodaysLog,
  EndOfDay,
  StaffBookings,
  StaffRestaurantPos,
  SellItem
} from './screens/staff'
import {
  OwnerDashboard,
  OwnerTransactions,
  OwnerMembers,
  OwnerInventory,
  OwnerRestaurantInventory,
  OwnerBookings,
  OwnerReports,
  OwnerSettings
} from './screens/owner'

function SetupWizard({ onDone }) {
  const [ownerName, setOwnerName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [staffName, setStaffName] = useState('')
  const [staffPin, setStaffPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setupInFlight = useRef(false)

  const submit = async () => {
    // A ref, not `loading`: setLoading is async, so disabled={loading} is not
    // applied until React re-renders and a re-entrant submit could slip past.
    if (loading || setupInFlight.current) return
    setError('')
    // Check required fields FIRST — on a blank form '' === '' passed the
    // password comparison vacuously and the user was told the PIN was wrong.
    if (!ownerName.trim() || !password || !staffName.trim() || !staffPin) {
      setError('All fields are required')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }
    if (!/^\d{4}$/.test(staffPin)) {
      setError('Staff PIN must be 4 digits')
      return
    }
    setupInFlight.current = true
    setLoading(true)
    const result = await api.setup({
      ownerName: ownerName.trim(),
      password,
      staffName: staffName.trim(),
      staffPin
    })
    setupInFlight.current = false
    setLoading(false)
    if (result?.success === false) {
      setError(result.error || 'Setup failed')
      return
    }
    onDone(result.user)
  }

  // Both login modals submit on Enter; the wizard is the first screen a new
  // user sees and was the only one that did not.
  const onEnter = (e) => {
    if (e.key === 'Enter') submit()
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        minHeight: '100%'
      }}
      className="fade-in"
    >
      <div className="card" style={{ width: 400, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 500 }}>Welcome to Refresh Manager</div>
          <div className="sub" style={{ marginTop: 4 }}>
            Set up your owner account and first staff PIN
          </div>
        </div>
        <div className="field">
          <label>Owner name</label>
          <input
            className="input"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            onKeyDown={onEnter}
            maxLength={60}
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
        <div className="field">
          <label>Confirm password</label>
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
        <div className="field">
          <label>First staff name</label>
          <input
            className="input"
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            onKeyDown={onEnter}
            maxLength={60}
          />
        </div>
        <div className="field">
          <label>Staff PIN (4 digits)</label>
          <input
            className="input"
            inputMode="numeric"
            value={staffPin}
            // Strip non-digits as typed, matching the login PIN field — the
            // wizard used to accept letters and only complain on submit.
            onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={onEnter}
            maxLength={4}
          />
        </div>
        {error && (
          <div className="alert red" style={{ marginBottom: 12 }}>
            <div className="a-desc">{error}</div>
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={loading} onClick={submit}>
          {loading ? 'Setting up…' : 'Complete setup'}
        </button>
      </div>
    </div>
  )
}

// Defined at module scope, not inside Login: a component created during render
// gets a new identity on every keystroke, so React remounts it and replays the
// scale-in animation — the modal visibly "blinks" on each PIN digit.
const Modal = ({ title, children, onClose }) => (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,.35)',
      display: 'grid',
      placeItems: 'center',
      zIndex: 50
    }}
    onClick={onClose}
  >
    <div
      className="card scale-in"
      style={{ width: 360, padding: 24 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 500 }}>{title}</div>
        <button className="btn btn-ghost" style={{ padding: 4 }} onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {children}
    </div>
  </div>
)

function Login({ onLogin }) {
  const [modal, setModal] = useState(null)
  const [pin, setPin] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Names of the active accounts, for the pickers. This is the one call that
  // must work before anyone has signed in, so it carries names and ids only.
  const [roster, setRoster] = useState({ staff: [], admins: [] })
  const [picked, setPicked] = useState(null)
  const pinInputRef = useRef(null)
  const loginInFlight = useRef(false)

  // Recovery-code redemption. Only offered once a code has actually been
  // generated (Settings -> Staff & Admins) — otherwise "Forgot your password?"
  // would be a dead end.
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
  const [notice, setNotice] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryAdminName, setRecoveryAdminName] = useState('')
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('')
  const [recoveryConfirm, setRecoveryConfirm] = useState('')
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const recoveryInFlight = useRef(false)

  useEffect(() => {
    api.listLoginRoster().then((r) => {
      // On failure leave the roster empty: both modals fall back to the plain
      // PIN / typed-username form, so a broken roster can never block sign-in.
      if (!r || r.success === false) return
      setRoster({ staff: r.staff || [], admins: r.admins || [] })
    })
    // Callable with no session by design — the login screen has to decide
    // whether to offer this before anyone has signed in.
    api.hasRecoveryCode().then((r) => {
      if (r?.exists) setRecoveryAvailable(true)
    })
  }, [])

  const openRecovery = () => {
    setModal('recover')
    setRecoveryError('')
    setRecoveryCode('')
    setRecoveryAdminName('')
    setRecoveryNewPassword('')
    setRecoveryConfirm('')
  }

  const submitRecovery = async () => {
    if (recoveryLoading || recoveryInFlight.current) return
    setRecoveryError('')
    // The admin name is a picker, not a text field: the handler deliberately
    // cannot say "no such admin" (that would make it an account-name oracle),
    // so a typo would otherwise be indistinguishable from a wrong code.
    if (!recoveryAdminName) {
      setRecoveryError('Choose which admin account to reset')
      return
    }
    if (!recoveryCode.trim()) {
      setRecoveryError('Enter the recovery code')
      return
    }
    if (!recoveryNewPassword || recoveryNewPassword.length < 4) {
      setRecoveryError('New password must be at least 4 characters')
      return
    }
    if (recoveryNewPassword !== recoveryConfirm) {
      setRecoveryError('Passwords do not match')
      return
    }
    recoveryInFlight.current = true
    setRecoveryLoading(true)
    const result = await api.recoverWithCode({
      code: recoveryCode,
      adminName: recoveryAdminName,
      newPassword: recoveryNewPassword
    })
    recoveryInFlight.current = false
    setRecoveryLoading(false)
    if (result?.success === false) {
      setRecoveryError(result.error || 'Recovery failed')
      return
    }
    // Not signed in — a code buys a new password, not a way in. Send them back
    // to the ordinary login with the new password already in hand.
    setModal(null)
    setRecoveryCode('')
    setRecoveryAdminName('')
    setRecoveryNewPassword('')
    setRecoveryConfirm('')
    setNotice('Password reset — sign in with your new password.')
  }

  // Close the open modal on Escape.
  useEffect(() => {
    if (!modal) return
    const onKey = (e) => {
      if (e.key === 'Escape') setModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  const submitStaff = async (pinValue = pin) => {
    if (loading || loginInFlight.current) return
    loginInFlight.current = true
    setError('')
    setLoading(true)
    // Deliberately still just the PIN. The picked name is a label for the
    // person at the desk; the PIN is what proves who they are and what every
    // sale is attributed to, so the picker cannot weaken or bypass the check.
    const result = await api.login({ pin: pinValue })
    loginInFlight.current = false
    setLoading(false)
    if (result?.success === false) {
      setError(result.error || 'Login failed')
      setPin('')
      pinInputRef.current?.focus()
      return
    }
    onLogin(result.user)
  }

  const submitOwner = async () => {
    if (loading || loginInFlight.current) return
    loginInFlight.current = true
    setError('')
    setLoading(true)
    const result = await api.login({ username, password })
    loginInFlight.current = false
    setLoading(false)
    if (result?.success === false) {
      setError(result.error || 'Login failed')
      return
    }
    onLogin(result.user)
  }

  // With one staff member on the roster there is nobody to choose between, so
  // go straight to the keypad — the desk should not gain an extra tap.
  const needsStaffPick = roster.staff.length > 1

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        minHeight: '100%'
      }}
      className="fade-in"
    >
      <div style={{ width: 340, textAlign: 'center' }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: 'linear-gradient(150deg,#185FA5,#0C447C)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 10px 24px -8px rgba(12,68,124,.5)'
          }}
        >
          <WaveMark size={34} />
        </div>
        <div style={{ fontSize: 23, fontWeight: 500, color: '#1a202c' }}>Refresh Manager</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Boudha, Kathmandu</div>
        {notice && (
          <div className="alert green" style={{ marginTop: 16, textAlign: 'left' }}>
            <div className="a-desc">{notice}</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 30 }}>
          <button
            className="btn btn-ghost btn-block"
            style={{ padding: 14, fontSize: 14 }}
            onClick={() => {
              setModal('staff')
              setError('')
              setPin('')
              setPicked(null)
            }}
          >
            <Icon name="user" size={18} /> Staff Login
          </button>
          <button
            className="btn btn-primary btn-block"
            style={{ padding: 14, fontSize: 14 }}
            onClick={() => {
              setModal('owner')
              setError('')
              // One admin means one possible answer — preselect it.
              setUsername(roster.admins.length === 1 ? roster.admins[0].name : '')
              setPassword('')
            }}
          >
            <Icon name="shield" size={18} /> Owner / Admin Login
          </button>
        </div>
      </div>
      {modal === 'staff' && (
        <Modal
          title={picked ? picked.name : 'Staff login'}
          onClose={() => {
            setModal(null)
            setPicked(null)
          }}
        >
          {needsStaffPick && !picked ? (
            <>
              <div className="sub" style={{ marginBottom: 10 }}>
                Tap your name
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 300,
                  overflowY: 'auto'
                }}
              >
                {roster.staff.map((s) => (
                  <button
                    key={s.id}
                    className="btn btn-ghost btn-block"
                    style={{ padding: 12, fontSize: 14 }}
                    onClick={() => {
                      setPicked(s)
                      setPin('')
                      setError('')
                    }}
                  >
                    <Icon name="user" size={16} /> {s.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Enter 4-digit PIN</label>
                <input
                  ref={pinInputRef}
                  className="input"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                    setPin(digits)
                    if (digits.length === 4) submitStaff(digits)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitStaff()
                  }}
                  maxLength={4}
                  autoFocus
                />
              </div>
              {error && (
                <div className="alert red" style={{ marginBottom: 10 }}>
                  <div className="a-desc">{error}</div>
                </div>
              )}
              <button
                className="btn btn-primary btn-block"
                disabled={loading}
                onClick={() => submitStaff()}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              {needsStaffPick && (
                <button
                  className="btn btn-ghost btn-block"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setPicked(null)
                    setPin('')
                    setError('')
                  }}
                >
                  <Icon name="chevron-left" size={15} /> Not you? Pick a different name
                </button>
              )}
            </>
          )}
        </Modal>
      )}
      {modal === 'owner' && (
        <Modal title="Owner login" onClose={() => setModal(null)}>
          <div className="field">
            <label>Username</label>
            {roster.admins.length > 0 ? (
              // Login matches the admin name exactly, so a typo reads as a wrong
              // password. Picking from the roster removes that failure mode.
              <select
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              >
                <option value="">Select your name…</option>
                {roster.admins.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitOwner()
                }}
                autoFocus
              />
            )}
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitOwner()
              }}
            />
          </div>
          {error && (
            <div className="alert red" style={{ marginBottom: 10 }}>
              <div className="a-desc">{error}</div>
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={loading} onClick={submitOwner}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          {recoveryAvailable && (
            <button
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8, fontSize: 13 }}
              onClick={openRecovery}
            >
              Forgot your password?
            </button>
          )}
        </Modal>
      )}
      {modal === 'recover' && (
        <Modal title="Reset password with recovery code" onClose={() => setModal(null)}>
          <div className="sub" style={{ marginBottom: 12 }}>
            Enter the recovery code that was written down when it was generated.
          </div>
          <div className="field">
            <label>Admin account</label>
            {/* A picker, not a text field — see submitRecovery for why. */}
            <select
              className="input"
              value={recoveryAdminName}
              onChange={(e) => setRecoveryAdminName(e.target.value)}
              autoFocus
            >
              <option value="">Select account…</option>
              {roster.admins.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Recovery code</label>
            <input
              className="input"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}
            />
          </div>
          <div className="field">
            <label>New password</label>
            <input
              className="input"
              type="password"
              value={recoveryNewPassword}
              onChange={(e) => setRecoveryNewPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input
              className="input"
              type="password"
              value={recoveryConfirm}
              onChange={(e) => setRecoveryConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRecovery()
              }}
            />
          </div>
          {recoveryError && (
            <div className="alert red" style={{ marginBottom: 10 }}>
              <div className="a-desc">{recoveryError}</div>
            </div>
          )}
          <button
            className="btn btn-primary btn-block"
            disabled={recoveryLoading}
            onClick={submitRecovery}
          >
            {recoveryLoading ? 'Resetting…' : 'Reset password'}
          </button>
        </Modal>
      )}
      <div style={{ position: 'absolute', bottom: 16, fontSize: 11.5, color: '#94a3b8' }}>v1.0</div>
    </div>
  )
}
function StaffInventory({ back }) {
  const [inv, setInv] = useState([])
  const [lowStock, setLowStock] = useState([])

  useEffect(() => {
    api.listPoolInventory().then((r) => setInv(r.items || []))
    api.poolLowStock().then((r) => setLowStock(r.items || []))
  }, [])

  return (
    <div className="content fade-in" style={{ maxWidth: 860, margin: '0 auto' }}>
      <SectionHead title="Inventory">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back to home
        </button>
      </SectionHead>
      {lowStock.length > 0 && (
        <div className="alert red" style={{ marginBottom: 14 }}>
          <Icon name="alert-triangle" size={17} />
          <div>
            <div className="a-title">{lowStock.length} items at or below reorder level</div>
            <div className="a-desc">
              {lowStock
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
            <th style={{ width: 140 }}>Variant</th>
            <th className="num" style={{ width: 80 }}>
              Stock
            </th>
            <th className="num" style={{ width: 100 }}>
              Reorder at
            </th>
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
              <td className="num" style={{ color: r.low ? '#ef4444' : '#1a202c' }}>
                {r.stock}
              </td>
              <td className="num" style={{ color: '#94a3b8' }}>
                {r.reorder}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The owner asked for a separate "staff login – swimming" and "staff login –
// restaurant". A station chosen after sign-in gets that separation out of one
// build: it picks the landing screen, the bottom nav, and which home tiles are
// shown. It is a layout choice, not a permission boundary — every staff screen
// is still reachable, which is what makes it safe to reverse if it turns out
// the desks want each other's tools after all. `hiddenTiles` holds STAFF_TILES
// ids rather than captions, so rewording a tile cannot change what a station
// hides.
const STATIONS = {
  pool: {
    label: 'Pool desk',
    icon: 'home',
    hint: 'Day passes, memberships, bookings and pool items',
    landing: 'home',
    hiddenTiles: [STAFF_TILES.RESTAURANT],
    tabs: [
      { k: 'home', icon: 'home', label: 'Home' },
      { k: 'new', icon: 'plus-circle', label: 'New Transaction' },
      { k: 'members', icon: 'users', label: 'Members' },
      { k: 'log', icon: 'list', label: "Today's Log" },
      { k: 'eod', icon: 'send', label: 'End of Day' }
    ]
  },
  restaurant: {
    label: 'Restaurant',
    icon: 'utensils',
    hint: 'Menu orders and checkout for the cafe',
    landing: 'restaurant',
    hiddenTiles: [
      STAFF_TILES.NEW,
      STAFF_TILES.INVENTORY,
      STAFF_TILES.BOOKINGS,
      STAFF_TILES.SELL_ITEM
    ],
    tabs: [
      { k: 'restaurant', icon: 'utensils', label: 'Restaurant' },
      { k: 'home', icon: 'home', label: 'Home' },
      { k: 'members', icon: 'users', label: 'Members' },
      { k: 'log', icon: 'list', label: "Today's Log" },
      { k: 'eod', icon: 'send', label: 'End of Day' }
    ]
  }
}

// Per-user and per-window: two people sharing a machine each keep their own
// station across a logout, and closing the app clears it so a workstation that
// gets moved does not silently keep yesterday's role. No schema change.
const stationKey = (userId) => `refresh.station.${userId ?? 'anon'}`
function readStation(userId) {
  try {
    const saved = window.sessionStorage?.getItem(stationKey(userId))
    return STATIONS[saved] ? saved : null
  } catch {
    return null
  }
}
function writeStation(userId, station) {
  try {
    window.sessionStorage?.setItem(stationKey(userId), station)
  } catch {
    /* storage unavailable — the station just won't survive a logout */
  }
}

function StationPicker({ session, onPick, onLogout }) {
  return (
    <div className="app">
      <AppHeader role="staff" session={session} onLogout={onLogout} />
      <div className="body-wrap">
        <div className="content fade-in" style={{ maxWidth: 680, margin: '0 auto' }}>
          <SectionHead title={`Hello ${session?.name || ''} — where are you working?`} />
          <div className="sub" style={{ marginBottom: 16 }}>
            This sets your home screen. You can switch at any time without signing out.
          </div>
          <div className="tiles">
            {Object.entries(STATIONS).map(([k, st]) => (
              // Real <button>s: as cards they took a click but could not be
              // tabbed to and announced as nothing, which stranded anyone not
              // using a mouse on the one screen they have to get past to work.
              // The inline styles only undo the button defaults `.tile` does
              // not already override, so the card still looks the same.
              <button
                key={k}
                type="button"
                className="tile"
                style={{ font: 'inherit', color: 'inherit', textAlign: 'left', width: '100%' }}
                onClick={() => onPick(k)}
              >
                <div
                  className="t-icon"
                  style={{ background: k === 'pool' ? '#E6F1FB' : '#fef3c7' }}
                >
                  <Icon name={st.icon} size={22} color={k === 'pool' ? '#185FA5' : '#b45309'} />
                </div>
                <div>
                  <div className="t-title">{st.label}</div>
                  <div className="t-sub" style={{ marginTop: 3 }}>
                    {st.hint}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StaffApp({ session, onLogout }) {
  const [station, setStation] = useState(() => readStation(session?.userId))
  const [tab, setTab] = useState(() => STATIONS[readStation(session?.userId)]?.landing || 'home')

  useEffect(() => {
    const onKey = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT'
      )
        return
      const map = { n: 'new', m: 'members', l: 'log', e: 'eod' }
      const next = map[e.key.toLowerCase()]
      if (next) setTab(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Switching station mid-shift lands you on that station's home rather than
  // leaving you on a screen the other desk was using.
  const chooseStation = (next) => {
    setStation(next)
    writeStation(session?.userId, next)
    setTab(STATIONS[next].landing)
  }

  if (!station)
    return <StationPicker session={session} onPick={chooseStation} onLogout={onLogout} />

  const tabs = STATIONS[station].tabs
  let screen
  if (tab === 'home')
    screen = <StaffHome key="home" go={setTab} hiddenTiles={STATIONS[station].hiddenTiles} />
  else if (tab === 'new') screen = <NewTransaction key="new" session={session} onDone={setTab} />
  else if (tab === 'members') screen = <MemberSearch key="members" />
  else if (tab === 'log') screen = <TodaysLog key="log" />
  else if (tab === 'eod') screen = <EndOfDay key="eod" session={session} />
  else if (tab === 'inv') screen = <StaffInventory key="inv" back={() => setTab('home')} />
  else if (tab === 'bookings') screen = <StaffBookings key="bookings" back={() => setTab('home')} />
  else if (tab === 'restaurant')
    screen = <StaffRestaurantPos session={session} back={() => setTab(STATIONS[station].landing)} />
  else if (tab === 'sellitem') screen = <SellItem key="sellitem" back={() => setTab('home')} />

  // Screens opened from a tile have no nav entry of their own, so they light up
  // Home — the place they were opened from.
  const navKeys = tabs.map((t) => t.k)
  const navActive = (k) => (navKeys.includes(tab) ? k === tab : k === 'home')

  return (
    <div className="app">
      <AppHeader role="staff" session={session} onLogout={onLogout} />
      <div className="body-wrap">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px 0',
              flexWrap: 'wrap'
            }}
          >
            <span className="sub">Station</span>
            {Object.entries(STATIONS).map(([k, st]) => (
              <button
                key={k}
                className={'btn ' + (k === station ? 'btn-primary' : 'btn-ghost')}
                style={{ padding: '5px 10px', fontSize: 12 }}
                onClick={() => chooseStation(k)}
              >
                <Icon name={st.icon} size={13} /> {st.label}
              </button>
            ))}
          </div>
          <ScreenErrorBoundary key={tab}>{screen}</ScreenErrorBoundary>
        </div>
      </div>
      <div className="botnav">
        {tabs.map((t) => (
          <div
            key={t.k}
            className={'tab' + (navActive(t.k) ? ' active' : '')}
            onClick={() => setTab(t.k)}
          >
            <Icon name={t.icon} size={20} />
            <span className="t-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OwnerApp({ session, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const nav = [
    { k: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { k: 'transactions', icon: 'receipt-text', label: 'Transactions' },
    { k: 'members', icon: 'users', label: 'Members' },
    { k: 'bookings', icon: 'calendar-days', label: 'Bookings' },
    { k: 'inventory', icon: 'package', label: 'Inventory' },
    { k: 'restaurant', icon: 'utensils', label: 'Restaurant' },
    { k: 'reports', icon: 'bar-chart-3', label: 'Reports' },
    { k: 'settings', icon: 'settings', label: 'Settings' }
  ]
  let ownerScreen
  if (tab === 'dashboard') ownerScreen = <OwnerDashboard key="dashboard" go={setTab} />
  else if (tab === 'transactions') ownerScreen = <OwnerTransactions key="transactions" />
  else if (tab === 'members') ownerScreen = <OwnerMembers key="members" />
  else if (tab === 'bookings') ownerScreen = <OwnerBookings key="bookings" session={session} />
  else if (tab === 'inventory') ownerScreen = <OwnerInventory key="inventory" session={session} />
  else if (tab === 'restaurant')
    ownerScreen = <OwnerRestaurantInventory key="restaurant" session={session} />
  else if (tab === 'reports') ownerScreen = <OwnerReports key="reports" />
  else if (tab === 'settings') ownerScreen = <OwnerSettings key="settings" />

  return (
    <div className="app">
      <AppHeader role="owner" session={session} onLogout={onLogout} />
      <div className="body-wrap">
        <div className="sidebar">
          {nav.map((n) => (
            <div
              key={n.k}
              className={'nav-item' + (n.k === tab ? ' active' : '')}
              onClick={() => setTab(n.k)}
            >
              <span className="ni-icon">
                <Icon name={n.icon} size={17} />
              </span>
              {n.label}
            </div>
          ))}
        </div>
        <ScreenErrorBoundary key={tab}>{ownerScreen}</ScreenErrorBoundary>
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('loading')
  const [session, setSession] = useState(null)
  const timeoutRef = useRef(null)
  const timeoutMinutesRef = useRef(30)

  const resetIdleTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (!session) return
    const ms = (timeoutMinutesRef.current || 30) * 60 * 1000
    timeoutRef.current = setTimeout(async () => {
      await api.logout()
      setSession(null)
      setView('login')
    }, ms)
  }, [session])

  useEffect(() => {
    async function init() {
      const needs = await api.needsSetup()
      if (needs) {
        setView('setup')
        return
      }
      const user = await api.getSession()
      if (user) {
        setSession(user)
        setView(user.role)
        const settings = await api.getSettings()
        timeoutMinutesRef.current = Number(settings.settings?.session_timeout_minutes) || 30
      } else setView('login')
    }
    init()
  }, [])

  useEffect(() => {
    if (window.__fitStage) window.__fitStage()
  }, [view])

  useEffect(() => {
    const onKey = async (e) => {
      const t = e.target
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (e.key === 'Escape' && view !== 'login' && view !== 'loading' && view !== 'setup') {
        await api.logout()
        setSession(null)
        setView('login')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  useEffect(() => {
    const h = document.getElementById('hint')
    if (!h) return
    h.innerHTML =
      view === 'login' || view === 'setup'
        ? 'Refresh Manager · sign in to begin'
        : 'Press <kbd>Esc</kbd> to log out · everything is clickable'
  }, [view])

  const handleLogin = async (user) => {
    setSession(user)
    setView(user.role)
    const settings = await api.getSettings()
    timeoutMinutesRef.current = Number(settings.settings?.session_timeout_minutes) || 30
  }
  const handleLogout = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    await api.logout()
    setSession(null)
    setView('login')
  }

  useEffect(() => {
    if (!session) return
    resetIdleTimer()
    // 3-F: reset on pointer and touch activity too, not just keyboard — reception
    // often works mouse/touch-only and shouldn't be logged out mid-task.
    const onActivity = () => resetIdleTimer()
    const events = ['mousemove', 'keydown', 'click', 'touchstart']
    events.forEach((e) => window.addEventListener(e, onActivity))
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity))
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [session, resetIdleTimer])

  if (view === 'loading')
    return (
      <Window onClose={() => window.close()}>
        <div className="content" style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <div className="sub">Loading…</div>
        </div>
      </Window>
    )

  return (
    <Window onClose={() => window.close()}>
      {view === 'setup' && <SetupWizard onDone={handleLogin} />}
      {view === 'login' && <Login onLogin={handleLogin} />}
      {view === 'staff' && <StaffApp key="staff" session={session} onLogout={handleLogout} />}
      {view === 'owner' && <OwnerApp key="owner" session={session} onLogout={handleLogout} />}
    </Window>
  )
}
