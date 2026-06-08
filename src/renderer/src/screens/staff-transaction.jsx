import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, categoryToUiType, uiTypeToDbType } from '../lib/format'
import { Icon } from '../components/ui'

const UI_TYPES = ['Membership', 'Day Package', 'Day Pass']

function groupProducts(products) {
  const grouped = {}
  for (const t of UI_TYPES) grouped[t] = []
  for (const p of products) {
    const ui = categoryToUiType(p.category)
    if (!grouped[ui]) grouped[ui] = []
    grouped[ui].push(p)
  }
  return grouped
}

export function NewTransaction({ session, onDone }) {
  const [step, setStep] = useState(0)
  const [type, setType] = useState('Day Pass')
  const [productId, setProductId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pay, setPay] = useState('Cash')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [products, setProducts] = useState([])
  const [grouped, setGrouped] = useState({})
  const [savedTxn, setSavedTxn] = useState(null)

  useEffect(() => {
    api.listProducts().then((r) => {
      const list = r.products || []
      setProducts(list)
      setGrouped(groupProducts(list))
    })
  }, [])

  const selected = products.find((p) => String(p.id) === String(productId))
  const amount = selected?.price ?? 0
  const allPricesZero = products.length > 0 && products.every((p) => !p.price)
  const labels = ['Type', 'Product', 'Customer', 'Payment', 'Confirm']

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const result = await api.createTransaction({
      type: uiTypeToDbType(type),
      source: 'pool',
      customerName: name || 'Walk-in',
      phone: phone || null,
      productId: selected?.id,
      amount,
      paymentMethod: pay.toLowerCase(),
      staffId: session?.userId
    })
    setSaving(false)
    if (result?.success === false) {
      setError(result.error || 'Failed to save transaction')
      return
    }
    setSavedTxn({
      transactionId: result.transactionId,
      product: selected?.displayName || selected?.name || productId,
      amount,
      pay
    })
    setSaved(true)
  }

  const handlePrint = async () => {
    if (!savedTxn) return
    await api.printTicket({
      transactionId: savedTxn.transactionId,
      customerName: name || 'Walk-in',
      product: savedTxn.product,
      amount: savedTxn.amount,
      paymentMethod: savedTxn.pay
    })
  }

  const reset = () => {
    setSaved(false)
    setSavedTxn(null)
    setStep(0)
    setType('Day Pass')
    setProductId('')
    setName('')
    setPhone('')
    setError('')
  }

  if (saved) {
    return (
      <div className="content fade-in" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card scale-in" style={{ width: 420, padding: '34px 28px', textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#dcfce7', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <Icon name="check" size={30} color="#16a34a" />
          </div>
          <div style={{ fontSize: 17, fontWeight: 500 }}>Transaction saved</div>
          <div className="sub" style={{ marginTop: 6 }}>{savedTxn?.product} · {fmt(savedTxn?.amount)} · {savedTxn?.pay}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 22, flexDirection: 'column' }}>
            <button className="btn btn-ghost btn-block" onClick={handlePrint}><Icon name="printer" size={16} /> Print Ticket</button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost btn-block" onClick={reset}>New transaction</button>
              <button className="btn btn-primary btn-block" onClick={() => onDone('home')}>Done</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const StepBar = () => (
    <div className="steps">
      {labels.map((l, i) => (
        <div key={l} className={'step ' + (i < step ? 'done' : i === step ? 'active' : '')}>
          {i < step && <Icon name="check" size={10} style={{ marginRight: 3, verticalAlign: '-1px' }} />}{l}
        </div>
      ))}
    </div>
  )

  const next = () => setStep((s) => Math.min(4, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))
  const typeProducts = grouped[type] || []

  return (
    <div className="content fade-in" style={{ display: 'grid', placeItems: 'start center', paddingTop: 26 }}>
      <div className="card" style={{ width: 500, padding: 22 }}>
        {allPricesZero && (
          <div className="alert amber" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={17} />
            <div><div className="a-title">All product prices are Rs. 0</div><div className="a-desc">Ask the owner to set prices in Settings → Pricing manager.</div></div>
          </div>
        )}
        <StepBar />
        {step === 0 && (
          <div className="fade-in">
            <div className="field">
              <label>Transaction type</label>
              <select className="select" value={type} onChange={(e) => { setType(e.target.value); setProductId('') }}>
                {UI_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <p className="sub" style={{ marginBottom: 4 }}>Pick what the customer is paying for to continue.</p>
          </div>
        )}
        {step === 1 && (
          <div className="fade-in">
            <div className="field">
              <label>Product</label>
              <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select a product…</option>
                {typeProducts.map((p) => <option key={p.id} value={p.id}>{p.displayName || p.name} — {fmt(p.price)}</option>)}
              </select>
            </div>
            {productId && <div className="amount-box"><span className="a-label">Amount</span><span className="a-value">{fmt(amount)}</span></div>}
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="field"><label>Transaction type</label><select className="select" value={type} disabled style={{ color: '#475569' }}><option>{type}</option></select></div>
            <div className="field"><label>Product</label><select className="select" value={productId} disabled style={{ color: '#475569' }}><option>{selected?.displayName || selected?.name}</option></select></div>
            <div className="field"><label>Customer name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></div>
            <div className="field"><label>Phone (optional)</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" /></div>
            <div className="amount-box"><span className="a-label">Amount</span><span className="a-value">{fmt(amount)}</span></div>
          </div>
        )}
        {step === 3 && (
          <div className="fade-in">
            <div className="amount-box" style={{ marginBottom: 16 }}><span className="a-label">Amount due</span><span className="a-value">{fmt(amount)}</span></div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#64748b', marginBottom: 8 }}>Payment method</label>
            <div className="toggle-row">
              <button className={'toggle-btn' + (pay === 'Cash' ? ' sel' : '')} onClick={() => setPay('Cash')}><Icon name="banknote" size={17} /> Cash</button>
              <button className={'toggle-btn' + (pay === 'QR' ? ' sel' : '')} onClick={() => setPay('QR')}><Icon name="qr-code" size={17} /> QR (eSewa / Khalti)</button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="fade-in">
            {[['Type', type], ['Product', selected?.displayName || selected?.name], ['Customer', name || 'Walk-in'], ['Phone', phone || '—'], ['Payment', pay]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>{k}</span><span style={{ color: '#1a202c' }}>{v}</span>
              </div>
            ))}
            <div className="amount-box" style={{ marginTop: 14 }}><span className="a-label">Total</span><span className="a-value">{fmt(amount)}</span></div>
          </div>
        )}
        {error && <div className="alert red" style={{ marginTop: 14 }}><Icon name="alert-triangle" size={17} /><div className="a-desc">{error}</div></div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 0 && <button className="btn btn-ghost" onClick={back}><Icon name="chevron-left" size={16} /> Back</button>}
          <div className="spacer" />
          {step < 4
            ? <button className="btn btn-primary" disabled={step === 1 && !productId} style={step === 1 && !productId ? { opacity: .5, cursor: 'not-allowed' } : null} onClick={next}>Continue <Icon name="chevron-right" size={16} /></button>
            : <button className="btn btn-primary btn-block" style={{ width: 'auto', flex: 1 }} disabled={saving} onClick={handleSave}><Icon name="check" size={16} /> {saving ? 'Saving…' : 'Confirm & Save'}</button>
          }
        </div>
      </div>
    </div>
  )
}
