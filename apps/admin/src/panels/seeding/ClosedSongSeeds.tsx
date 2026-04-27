import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { SongSeedRow, StoreSummary, SongSeedStatus } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Select, PanelHeader, S } from '../../ui/index.js'

const STATUS_FILTERS: { key: string; label: string; status: SongSeedStatus }[] = [
  { key: 'abandoned', label: 'abandoned', status: 'abandoned' },
  { key: 'skipped', label: 'skipped', status: 'skipped' },
  { key: 'failed', label: 'failed', status: 'failed' },
]

export function ClosedSongSeeds() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [icpId, setIcpId] = useState<string>('')
  const [status, setStatus] = useState<SongSeedStatus>('abandoned')
  const [rows, setRows] = useState<SongSeedRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
  }, [])

  const reload = async () => {
    const token = getToken(); if (!token) return
    setLoading(true); setErr(null)
    try {
      const r = await api.songSeeds(token, { icpId: icpId || undefined, status, limit: 100 })
      setRows(r)
    } catch (e: any) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [icpId, status])

  const icps = uniqueIcps(stores ?? [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Closed Song Seeds"
        subtitle="Song seeds that didn't make it into the pool — operator-abandoned, skipped, or assembly-failed. Useful for spotting hook-pool drift or systematic Mars/Bernie failures."
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_FILTERS.map((f) => {
            const on = status === f.status
            return (
              <button key={f.key} onClick={() => setStatus(f.status)} style={{
                background: on ? T.surfaceRaised : 'transparent',
                border: `1px solid ${on ? T.accent : T.border}`,
                color: on ? T.accent : T.textMuted,
                padding: '5px 12px', borderRadius: 4,
                fontFamily: T.mono, fontSize: 12, cursor: 'pointer',
              }}>{f.label}</button>
            )
          })}
        </div>
        <span style={{ fontSize: S.label, color: T.textDim, fontFamily: T.sans, textTransform: 'uppercase', letterSpacing: '0.04em' }}>icp</span>
        <Select value={icpId} onChange={(e) => setIcpId(e.target.value)} style={{ minWidth: 220, width: 'auto' }}>
          <option value="">all ICPs</option>
          {icps.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </Select>
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="ghost" onClick={reload} disabled={loading}>refresh</Button>
        </span>
      </div>

      {err && <div style={{ fontSize: 12, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {loading && !rows && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {rows && (
        <>
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim }}>
            {rows.length} {status} song seed{rows.length === 1 ? '' : 's'}
          </div>

          <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
            <Header />
            {rows.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>
                no {status} song seeds match
              </div>
            )}
            {rows.map((r) => <Row key={r.id} row={r} />)}
          </div>
        </>
      )}
    </div>
  )
}

const COLS = '120px 1.4fr 1fr 1.6fr 1fr'

function Header() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.mono, fontSize: 11, color: T.textDim, textTransform: 'uppercase',
    }}>
      <span>terminal at</span>
      <span>hook</span>
      <span>outcome</span>
      <span>error / reason</span>
      <span>title</span>
    </div>
  )
}

function Row({ row }: { row: SongSeedRow }) {
  const ts = row.terminalAt ?? row.updatedAt
  const date = new Date(ts)
  const fmt = date.toISOString().slice(0, 10) + ' ' + date.toISOString().slice(11, 16)
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.mono, fontSize: 12, alignItems: 'center',
    }}>
      <span style={{ color: T.textMuted, fontSize: 11 }}>{fmt}</span>
      <span style={trunc} title={row.hook?.text ?? ''}>{row.hook?.text ?? '—'}</span>
      <span style={{ color: T.textMuted, ...trunc }}>—</span>
      <span style={{ color: row.errorText ? T.danger : T.textDim, ...trunc }} title={row.errorText ?? ''}>
        {row.errorText ?? (row.status === 'abandoned' ? 'operator abandoned' : row.status === 'skipped' ? 'operator skipped' : '—')}
      </span>
      <span style={{ color: T.textMuted, fontFamily: T.sans, ...trunc }}>{row.title ?? '—'}</span>
    </div>
  )
}

const trunc: any = { color: T.text, fontFamily: T.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function uniqueIcps(stores: StoreSummary[]): { id: string; label: string }[] {
  const m = new Map<string, string>()
  for (const s of stores) {
    if (s.icp && !m.has(s.icp.id)) m.set(s.icp.id, `${s.clientName} — ${s.name}`)
  }
  return [...m.entries()].map(([id, label]) => ({ id, label }))
}
