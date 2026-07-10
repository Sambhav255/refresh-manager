import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, SectionHead } from '../components/ui'

export function BackupSettings({ back }) {
  const [status, setStatus] = useState(null)
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [schedule, setSchedule] = useState('23:59')
  const [autoEnabled, setAutoEnabled] = useState(true)
  const [restorePath, setRestorePath] = useState('')
  const [restorePassword, setRestorePassword] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [restored, setRestored] = useState(false)

  const load = async () => {
    setLoading(true)
    const s = await api.getBackupStatus()
    const b = await api.listBackups()
    setStatus(s)
    setBackups(b.backups || [])
    setSchedule(s.schedule || '23:59')
    setAutoEnabled(s.autoEnabled !== false)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const pickFolder = async () => {
    setBusy('folder')
    const r = await api.pickBackupFolder()
    setBusy('')
    if (r?.success) load()
    else if (!r?.cancelled) setError(r?.error || 'Failed to pick folder')
  }

  const saveSettings = async () => {
    await api.setSetting({ key: 'backup_schedule', value: schedule })
    await api.setSetting({ key: 'backup_auto_enabled', value: autoEnabled ? 'true' : 'false' })
    // Only overwrite the passphrase when the owner typed a new one.
    if (passphrase) {
      await api.setSetting({ key: 'backup_passphrase', value: passphrase })
      setPassphrase('')
      load()
    }
  }

  const backupNow = async () => {
    setBusy('backup')
    setError('')
    const r = await api.createBackup()
    setBusy('')
    if (r?.success === false) setError(r.error || 'Backup failed')
    else load()
  }

  const restore = async () => {
    if (!restorePath || !restorePassword) {
      setError('Select a backup and enter owner password')
      return
    }
    if (!confirm('Restore will overwrite all current data. Continue?')) return
    setBusy('restore')
    setError('')
    const r = await api.restoreBackup({
      backupFilePath: restorePath,
      password: restorePassword,
      backupPassphrase: restorePassphrase
    })
    if (r?.success === false) {
      setBusy('')
      setError(r.error || 'Restore failed')
    } else {
      // Main process closes the DB, replaces the file, and relaunches the app.
      setRestored(true)
    }
  }

  if (restored) {
    return (
      <div className="content fade-in" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card scale-in" style={{ width: 380, padding: 28, textAlign: 'center' }}>
          <Icon name="check-circle" size={34} color="#0F6E56" />
          <div style={{ fontSize: 16, fontWeight: 500, marginTop: 12 }}>Backup restored</div>
          <div className="sub" style={{ marginTop: 6 }}>
            The app will restart automatically to load the restored data…
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="content fade-in">
        <SectionHead title="Backup settings">
          <button className="btn btn-ghost" onClick={back}>
            <Icon name="chevron-left" size={15} /> Back
          </button>
        </SectionHead>
        <div className="sub">Loading backup settings…</div>
      </div>
    )
  }

  return (
    <div className="content fade-in">
      <SectionHead title="Backup settings">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>

      <div className="card" style={{ padding: 16, marginBottom: 14, maxWidth: 520 }}>
        <div className="field">
          <label>Backup folder</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" readOnly value={status?.backupPath || 'Not configured'} />
            <button className="btn btn-ghost" disabled={!!busy} onClick={pickFolder}>
              Browse
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
            />
            Auto-backup daily
          </label>
          <input
            className="input"
            type="time"
            style={{ width: 120 }}
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
        </div>
        <div className="field">
          <label>
            Backup encryption passphrase{' '}
            {status?.encryptionConfigured ? '(set — leave blank to keep)' : '(recommended)'}
          </label>
          <input
            className="input"
            type="password"
            placeholder={
              status?.encryptionConfigured ? '••••••••' : 'Set a passphrase to encrypt backups'
            }
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <div className="sub" style={{ marginTop: 4, fontSize: 11.5 }}>
            {status?.encryptionConfigured
              ? 'Backups are encrypted (AES-256) and bundle member photos. Keep this passphrase safe — it is required to restore.'
              : 'Without a passphrase, backups are a plain database file that leaves the premises unencrypted. Setting one encrypts backups and includes member photos.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            disabled={!!busy}
            onClick={async () => {
              await saveSettings()
              backupNow()
            }}
          >
            {busy === 'backup' ? 'Backing up…' : 'Backup now'}
          </button>
          <button className="btn btn-ghost" disabled={!!busy} onClick={saveSettings}>
            Save settings
          </button>
        </div>
        {status?.lastBackupAt && (
          <div className="sub" style={{ marginTop: 10 }}>
            Last backup: {status.lastBackupAt} — {status.status === 'success' ? '✓' : 'Failed'}
          </div>
        )}
      </div>

      {error && (
        <div className="alert red" style={{ marginBottom: 12, maxWidth: 520 }}>
          <div className="a-desc">{error}</div>
        </div>
      )}

      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Recent backups</div>
      {backups.length === 0 ? (
        <div className="sub">No backups found in the configured folder.</div>
      ) : (
        <table className="tbl" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th>File</th>
              <th style={{ width: 100 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {backups.slice(0, 10).map((b) => (
              <tr key={b.filePath}>
                <td style={{ fontSize: 12.5 }}>{b.fileName}</td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => setRestorePath(b.filePath)}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {restorePath && (
        <div className="card" style={{ padding: 14, marginTop: 14, maxWidth: 420 }}>
          <div className="alert amber" style={{ marginBottom: 10 }}>
            <div className="a-desc">Dangerous: restores {restorePath.split('/').pop()}</div>
          </div>
          <div className="field">
            <label>Owner password</label>
            <input
              className="input"
              type="password"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
            />
          </div>
          {restorePath.endsWith('.rmbak') && (
            <div className="field">
              <label>Backup passphrase</label>
              <input
                className="input"
                type="password"
                placeholder="Leave blank to use the saved passphrase"
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
              />
            </div>
          )}
          <button className="btn btn-primary" disabled={!!busy} onClick={restore}>
            {busy === 'restore' ? 'Restoring…' : 'Confirm restore'}
          </button>
        </div>
      )}
    </div>
  )
}
