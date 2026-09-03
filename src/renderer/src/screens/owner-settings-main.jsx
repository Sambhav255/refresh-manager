import { useState } from 'react'
import { Icon, SectionHead } from '../components/ui'
import { settings } from '../data/mock'
import { PricingManager } from './owner-settings-pricing'
import { ManageStaff } from './owner-settings-staff'
import { BackupSettings } from './owner-settings-backup'
import { RestaurantMenuSettings } from './owner-settings-restaurant-menu'
import {
  WhatsAppSettings,
  BusinessInfo,
  RenewalTemplateSettings,
  UnifiedTillSettings
} from './owner-settings-extras'
import { AuditLog } from './owner-settings-audit'
import { AboutSettings } from './owner-settings-about'

const SUB_SCREENS = {
  'Pricing manager': 'pricing',
  'Staff PINs': 'staff',
  'WhatsApp number': 'whatsapp',
  'Backup settings': 'backup',
  'Restaurant menu': 'restaurant-menu',
  'Renewal reminders': 'reminders',
  'Business info': 'business',
  'One-screen till': 'unified-till',
  'Audit log': 'audit',
  'About & updates': 'about'
}

export function OwnerSettings() {
  const [sub, setSub] = useState(null)

  if (sub === 'pricing') return <PricingManager back={() => setSub(null)} />
  if (sub === 'staff') return <ManageStaff back={() => setSub(null)} />
  if (sub === 'whatsapp') return <WhatsAppSettings back={() => setSub(null)} />
  if (sub === 'backup') return <BackupSettings back={() => setSub(null)} />
  if (sub === 'restaurant-menu') return <RestaurantMenuSettings back={() => setSub(null)} />
  if (sub === 'reminders') return <RenewalTemplateSettings back={() => setSub(null)} />
  if (sub === 'business') return <BusinessInfo back={() => setSub(null)} />
  if (sub === 'unified-till') return <UnifiedTillSettings back={() => setSub(null)} />
  if (sub === 'about') return <AboutSettings back={() => setSub(null)} />
  if (sub === 'audit') return <AuditLog back={() => setSub(null)} />

  const cards = [
    ...settings.filter((s) => s.title !== 'Product manager'),
    { icon: 'utensils', title: 'Restaurant menu', desc: 'Menu items for staff POS' },
    {
      icon: 'message-circle',
      title: 'Renewal reminders',
      desc: 'WhatsApp template for expiring members'
    },
    {
      icon: 'layout-grid',
      title: 'One-screen till',
      desc: 'Single cart instead of the five-step wizard'
    },
    { icon: 'shield', title: 'Audit log', desc: 'Voids, refunds, restores, changes' },
    {
      icon: 'download',
      title: 'About & updates',
      desc: 'Version, check for updates, install'
    }
  ]

  return (
    <div className="content fade-in">
      <SectionHead title="Settings" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {cards.map((s) => (
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
