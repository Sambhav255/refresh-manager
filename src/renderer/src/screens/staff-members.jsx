import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Icon, Badge, Avatar } from '../components/ui'

export function MemberSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      const r = await api.searchMembers({ query: q })
      setResults(r.members || [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="content fade-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex'
            }}
          >
            <Icon name="search" size={16} color="#94a3b8" />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or phone..."
          />
        </div>
      </div>
      <div className="sub" style={{ marginBottom: 12 }}>
        {loading
          ? 'Searching...'
          : `${results.length} result${results.length !== 1 ? 's' : ''} found}`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {results.map((m) => {
          const mem = m.activeMembership
          const status = mem?.uiStatus || 'Expired'
          const type = mem?.productName || 'No active membership'
          const expiry = mem?.endDisplay || '√'
          return (
            <div
              key={m.id}
              className="card"
              style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <Avatar initials={m.initials} status={status} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                <div className="sub" style={{ color: '#64748b', marginTop: 2 }}>
                  {type} ∘ {m.phone || '√'}
                </div>
              </div>
              <div
                style={{
                  textAlign: 'right',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  alignItems: 'flex-end'
                }}
              >
                <Badge kind={status} />
                <span
                  style={{
                    fontSize: 11.5,
                    color:
                      status === 'Expiring soon'
                        ? '#b45309'
                        : status === 'Expired'
                          ? '#991b1b'
                          : '#94a3b8'
                  }}
                >
                  Expires {expiry}
                </span>
              </div>
            </div>
          )
        })}
        {q.trim() && !loading && results.length === 0 && (
          <div
            className="card"
            style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}
          >
            No members match {q}.
          </div>
        )}
      </div>
    </div>
  )
}
