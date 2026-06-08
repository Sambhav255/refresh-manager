import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, SectionHead } from '../components/ui'
import { settings } from '../data/mock'
import { PricingManager } from './owner-settings-pricing'
import { ManageStaff } from './owner-settings-staff'

function WhatsAppSettings({ back }) {
  const [number, setNumber] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getSettings().then((r) => setNumber(r.settings?.whatsapp_owner_number || ''))
  }, [])

  const save = async () => {
    await api.setSetting({ key: 'whatsapp_owner_number', value: number })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

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

function BusinessInfo({ back }) {
  const [form, setForm] = useState({ business_name: '', business_phone: '', business_address: '' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getSettings().then((r) => {
      const s = r.settings || {}
      setForm({
        business_name: s.business_name || '',
        business_phone: s.business_phone || '',
        business_address: s.business_address || ''
      })
    })
  }, [])

  const save = async () => {
    for (const [key, value] of Object.entries(form)) {
      await api.setSetting({ key, value })
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

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
        <button className="btn btn-primary" onClick={save}>
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  )
}

const SUB_SCREENS = {
  'Pricing manager': 'pricing',
  'Staff PINs': 'staff',
  'WhatsApp number': 'whatsapp',
  'Business info': 'business'
}

export function OwnerSettings() {
  const [sub, setSub] = useState(null)

  if (sub === 'pricing') return <PricingManager back={() => setSub(null)} />
  if (sub === 'staff') return <ManageStaff back={() => setSub(null)} />
  if (sub === 'whatsapp') return <WhatsAppSettings back={() => setSub(null)} />
  if (sub === 'business') return <BusinessInfo back={() => setSub(null)} />

  return (
    <div className="content fade-in">
      <SectionHead title="Settings" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {settings.map((s) => (
          <div
            key={s.title}
            className="settings-card card"
            style={{
              padding: '15px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 13,
              cursor: SUB_SCREENS[s.title] ? 'pointer' : 'default',
              opacity: SUB_SCREENS[s.title] ? 1 : 0.6
            }}
            onClick={() => SUB_SCREENS[s.title] && setSub(SUB_SCREENS[s.title])}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: '#E6F1FB',
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 38px'
              }}
            >
              <Icon name={s.icon} size={18} color="#185FA5" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.title}</div>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{s.desc}</div>
            </div>
            <Icon name="chevron-right" size={17} color="#94a3b8" />
          </div>
        ))}
      </div>
    </div>
  )
}
