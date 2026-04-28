import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { PoolDepthResponse, PoolStatus } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, PanelHeader, S } from '../../ui/index.js'

type Sort = 'low' | 'icp' | 'outcome'

export function PoolDepth() {
  const [data, setData] = useState<PoolDepthResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('low')

  const reload = async () => {
    const token = getToken(); if (!token) return
    try { setData(await api.poolDepth(token)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  const flat = useMemo(() => {
    if (!data) return []
    const rows: { icpId: string; icpName: string; clientName: string | null; storeNames: string; outcomeId: string; outcomeTitle: string; outcomeDisplayTitle: string | null; outcomeVersion: number; count: number; status: PoolStatus }[] = []
    for (const icp of data.icps) {
      const storeNames = icp.stores.map((s) => s.name).join(', ') || '—'
      for (const cell of icp.outcomes) {
        rows.push({
          icpId: icp.id, icpName: icp.name, clientName: icp.clientName, storeNames,
          outcomeId: cell.outcome.id, outcomeTitle: cell.outcome.title, outcomeDisplayTitle: cell.outcome.displayTitle, outcomeVersion: cell.outcome.version,
          count: cell.count, status: cell.status,
        })
      }
    }
    if (sort === 'low') {
      const rank = { critical: 0, thin: 1, ok: 2 } as const
      rows.sort((a, b) => rank[a.status] - rank[b.status] || a.count - b.count || a.icpName.localeCompare(b.icpName))
    } else if (sort === 'icp') {
      rows.sort((a, b) => a.icpName.localeCompare(b.icpName) || (a.outcomeDisplayTitle ?? a.outcomeTitle).localeCompare(b.outcomeDisplayTitle ?? b.outcomeTitle))
    } else {
      rows.sort((a, b) => (a.outcomeDisplayTitle ?? a.outcomeTitle).localeCompare(b.outcomeDisplayTitle ?? b.outcomeTitle) || a.icpName.localeCompare(b.icpName))
    }
    return rows
  }, [data, sort])

  const summary = useMemo(() => {
    if (!data) return { critical: 0, thin: 0, ok: 0, total: 0 }
    const out = { critical: 0, thin: 0, ok: 0, total: 0 }
    for (const icp of data.icps) for (const cell of icp.outcomes) {
      out[cell.status]++
      out.total++
    }
    return out
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Pool Depth"
        subtitle=""
      />

      {data && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <SummaryChip label="critical" count={summary.critical} color={T.danger} hint={`< ${data.thresholds.critical}`} />
          <SummaryChip label="low" count={summary.thin} color={T.warn} hint={`< ${data.thresholds.thin}`} />
          <SummaryChip label="ok" count={summary.ok} color={T.success} hint={`≥ ${data.thresholds.thin}`} />
          <SummaryChip label="total pools" count={summary.total} color={T.textMuted} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>sort</span>
        {(['low', 'icp', 'outcome'] as const).map((s) => {
          const on = sort === s
          return (
            <button key={s} onClick={() => setSort(s)} style={{
              background: on ? T.surfaceRaised : 'transparent',
              border: `1px solid ${on ? T.accent : T.border}`,
              color: on ? T.accent : T.textMuted,
              padding: '5px 12px', borderRadius: 4,
              fontFamily: T.mono, fontSize: 14, cursor: 'pointer',
            }}>{s}</button>
          )
        })}
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="ghost" onClick={reload}>refresh</Button>
        </span>
      </div>

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {!data && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {data && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <HeaderRow />
          {flat.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 14 }}>
              no ICP × Outcome combinations yet
            </div>
          )}
          {flat.map((r) => (
            <DataRow key={r.icpId + '::' + r.outcomeId} row={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryChip({ label, count, color, hint }: { label: string; count: number; color: string; hint?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      padding: '10px 16px', borderRadius: 4,
      border: `1px solid ${T.border}`, background: T.surface,
      minWidth: 110,
    }}>
      <div style={{ fontFamily: T.mono, fontSize: 25, color, fontWeight: 600, lineHeight: 1 }}>{count}</div>
      <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}{hint ? ` · ${hint}` : ''}
      </div>
    </div>
  )
}

const COLS = '1.6fr 1.8fr 1.6fr 90px 100px'

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase',
    }}>
      <span>icp</span>
      <span>locations</span>
      <span>outcome</span>
      <span style={{ textAlign: 'right' }}>count</span>
      <span style={{ textAlign: 'right' }}>depth</span>
    </div>
  )
}

function DataRow({ row }: {
  row: { icpName: string; clientName: string | null; storeNames: string; outcomeTitle: string; outcomeDisplayTitle: string | null; outcomeVersion: number; count: number; status: PoolStatus }
}) {
  const color = row.status === 'critical' ? T.danger : row.status === 'thin' ? T.warn : T.success
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.mono, fontSize: 14, alignItems: 'center',
    }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500, ...cellTrunc }}>{row.icpName}</span>
        {row.clientName && <span style={{ color: T.textDim, fontSize: 12, ...cellTrunc }}>{row.clientName}</span>}
      </span>
      <span style={cellTrunc}>{row.storeNames}</span>
      <span style={cellTrunc}>{row.outcomeDisplayTitle ?? row.outcomeTitle}</span>
      <span style={{ color, textAlign: 'right', fontWeight: 600 }}>{row.count}</span>
      <span style={{ color, textAlign: 'right', fontSize: 13, textTransform: 'uppercase' }}>{row.status}</span>
    </div>
  )
}

const cellTrunc: CSSProperties = {
  color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
