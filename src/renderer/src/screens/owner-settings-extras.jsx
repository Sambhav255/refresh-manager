import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, SectionHead } from '../components/ui'

export function WhatsAppSettings({ back }) {
  const [number, setNumber] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSettings().then((r) => {
      setNumber(r.settings?.whatsapp_owner_number || '')
      setLoading(false)
    })
  }, [])

  const save = async () => {
    await api.setSetting({ key: 'whatsapp_owner_number', value: number })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading)
    return (
      <div className="content">
        <div className="sub">Loading…</div>
      </div>
    )

  return (
    <div className="content fade-in">
      <SectionHead title="WhatsApp number">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>
      <div className="card" style={{ padding: 16, maxWidth: 420 }}>
        <div className="field">
          <label>Owner WhatsApp number</label>
          <input
            className="input"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. 97798XXXXXXXX"
          />
        </div>
        <button className="btn btn-primary" onClick={save}>
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export function BusinessInfo({ back }) {
  const [form, setForm] = useState({
    business_name: '',
    business_phone: '',
    business_address: '',
    receipt_width: '80'
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSettings().then((r) => {
      const s = r.settings || {}
      setForm({
        business_name: s.business_name || '',
        business_phone: s.business_phone || '',
        business_address: s.business_address || '',
        receipt_width: s.receipt_width || '80'
      })
      setLoading(false)
    })
  }, [])

  const save = async () => {
    for (const [key, value] of Object.entries(form)) {
      await api.setSetting({ key, value })
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading)
    return (
      <div className="content">
        <div className="sub">Loading…</div>
      </div>
    )

  return (
    <div className="content fade-in">
      <SectionHead title="Business info">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>
      <div className="card" style={{ padding: 16, maxWidth: 480 }}>
        {Object.entries({
          business_name: 'Business name',
          business_phone: 'Phone',
          business_address: 'Address'
        }).map(([k, label]) => (
          <div key={k} className="field">
            <label>{label}</label>
            <input
              className="input"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </div>
        ))}
        <div className="field">
          <label>Receipt / ticket size</label>
          <select
            className="input"
            value={form.receipt_width}
            onChange={(e) => setForm({ ...form, receipt_width: e.target.value })}
          >
            <option value="80">80mm thermal roll</option>
            <option value="58">58mm thermal roll</option>
            <option value="a4">A4 / Letter sheet</option>
          </select>
          <div className="sub" style={{ marginTop: 4, fontSize: 11.5 }}>
            Match your reception printer. Test a print after changing — thermal widths are
            printer-dependent.
          </div>
        </div>
        <button className="btn btn-primary" onClick={save}>
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export function RenewalTemplateSettings({ back }) {
  const [template, setTemplate] = useState('')
  const [timeout, setTimeout_] = useState('30')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSettings().then((r) => {
      setTemplate(r.settings?.renewal_reminder_template || '')
      setTimeout_(r.settings?.session_timeout_minutes || '30')
      setLoading(false)
    })
  }, [])

  const save = async () => {
    await api.setSetting({ key: 'renewal_reminder_template', value: template })
    await api.setSetting({ key: 'session_timeout_minutes', value: timeout })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading)
    return (
      <div className="content">
        <div className="sub">Loading…</div>
      </div>
    )

  return (
    <div className="content fade-in">
      <SectionHead title="Renewal reminders">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>
      <div className="card" style={{ padding: 16, maxWidth: 520 }}>
        <div className="field">
          <label>Message template</label>
          <textarea
            className="input"
            rows={8}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            style={{ resize: 'vertical' }}
          />
          <div className="sub" style={{ marginTop: 4 }}>
            Placeholders: [Name], [Membership Type], [Date]
          </div>
        </div>
        <div className="field">
          <label>Session timeout (minutes)</label>
          <input
            className="input"
            type="number"
            value={timeout}
            onChange={(e) => setTimeout_(e.target.value)}
            style={{ width: 100 }}
          />
        </div>
        <button className="btn btn-primary" onClick={save}>
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  )
}
