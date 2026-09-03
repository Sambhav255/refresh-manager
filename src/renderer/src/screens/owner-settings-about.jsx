import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, SectionHead } from '../components/ui'

export function AboutSettings({ back }) {
  const [info, setInfo] = useState(null)
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(false)
  const [updateState, setUpdateState] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [changelog, setChangelog] = useState('')

  useEffect(() => {
    api.getUpdateInfo().then(setInfo)
    api.getSession().then(setSession)
  }, [])

  const staffActive = session?.role === 'staff'

  const checkUpdates = async () => {
    setChecking(true)
    setError('')
    const r = await api.checkForUpdates()
    setChecking(false)
    if (r?.success === false) {
      setError(r.error || 'Could not check for updates')
      return
    }
    setUpdateState(r)
  }

  const downloadUpdate = async () => {
    setBusy('download')
    setError('')
    const r = await api.downloadUpdate()
    setBusy('')
    if (r?.success === false) setError(r.error || 'Download failed')
    else setUpdateState((s) => ({ ...s, downloaded: true, version: r.version || s?.version }))
  }

  const installDownloaded = async () => {
    if (!confirm('Install the downloaded update now? The app will close and restart.')) return
    setBusy('install')
    setError('')
    const r = await api.installDownloadedUpdate()
    if (r?.success === false) {
      setBusy('')
      setError(r.error || 'Install failed')
    }
  }

  const installFromFile = async () => {
    const pick = await api.pickUpdateInstaller()
    if (pick?.cancelled) return
    if (pick?.success === false) {
      setError(pick.error || 'Could not open installer')
      return
    }
    const name = pick.fileName || 'installer'
    if (
      !confirm(
        `Install ${name}? This replaces the app. Make sure staff are logged out and End of Day is done.`
      )
    ) {
      return
    }
    setBusy('file')
    setError('')
    const r = await api.installUpdateFromFile({ installerPath: pick.filePath })
    if (r?.success === false) {
      setBusy('')
      setError(r.error || 'Install failed')
    }
  }

  const openChangelog = async () => {
    const r = await api.getChangelog()
    setChangelog(r?.content || '# No changelog available.')
    setChangelogOpen(true)
  }

  const showUpdateActions = updateState?.updateAvailable && !updateState?.devMode

  return (
    <div className="content fade-in">
      <SectionHead title="About & updates">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
      </SectionHead>

      <div className="card" style={{ padding: 16, marginBottom: 14, maxWidth: 520 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Current version</div>
        <div className="sub" style={{ lineHeight: 1.6 }}>
          Version {info?.version || '…'}
          <br />
          Build {info?.gitSha || '—'}
          {info?.buildDate ? (
            <>
              <br />
              Built {info.buildDate}
            </>
          ) : null}
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={openChangelog}>
          What&apos;s new
        </button>
      </div>

      <div className="alert amber" style={{ marginBottom: 14, maxWidth: 520 }}>
        <div className="a-desc">
          {staffActive
            ? 'A staff session is active. Log out staff and finish End of Day before installing updates.'
            : 'Before updating, have all staff log out and finish End of Day so no sale is left open.'}
        </div>
      </div>

      <div className="card" style={{ padding: 16, maxWidth: 520 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <button className="btn btn-primary" disabled={checking || !!busy} onClick={checkUpdates}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {showUpdateActions && (
            <>
              <button
                className="btn btn-ghost"
                disabled={!!busy || staffActive}
                onClick={downloadUpdate}
              >
                {busy === 'download' ? 'Downloading…' : 'Download update'}
              </button>
              <button
                className="btn btn-ghost"
                disabled={!!busy || staffActive || !updateState?.downloaded}
                onClick={installDownloaded}
              >
                {busy === 'install' ? 'Installing…' : 'Install downloaded update'}
              </button>
            </>
          )}
          <button
            className="btn btn-ghost"
            disabled={!!busy || staffActive}
            onClick={installFromFile}
          >
            {busy === 'file' ? 'Starting…' : 'Install from file…'}
          </button>
        </div>

        {updateState?.devMode && (
          <div className="sub">{updateState.message || 'Updates apply to installed builds only.'}</div>
        )}
        {updateState?.updateAvailable === false && updateState?.success && !updateState?.devMode && (
          <div className="sub">You are on the latest version ({updateState.version}).</div>
        )}
        {updateState?.updateAvailable && (
          <div className="sub" style={{ marginTop: 6 }}>
            Update available: v{updateState.version}
          </div>
        )}
        {error && (
          <div className="alert red" style={{ marginTop: 10 }}>
            <div className="a-desc">{error}</div>
          </div>
        )}
      </div>

      {changelogOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 50
          }}
          onClick={() => setChangelogOpen(false)}
        >
          <div
            className="card scale-in"
            style={{ width: 520, maxHeight: '80vh', padding: 20, overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 500 }}>What&apos;s new</div>
              <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setChangelogOpen(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{changelog}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
