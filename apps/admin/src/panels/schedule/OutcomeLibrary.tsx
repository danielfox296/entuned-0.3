import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'

type Row = OutcomeRowFull & { lineageCount: number }
type Filter = 'active' | 'superseded' | 'all'

export function OutcomeLibrary() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomeLibrary(token).then(setRows).catch((e) => setErr(e.message))
  }, [])

  const visible = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'active' && r.supersededAt) return false
      if (filter === 'superseded' && !r.supersededAt) return false
      if (q && !r.title.toLowerCase().includes(q) && !(r.mode ?? '').toLowerCase().includes(q) && !(r.instrumentation ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filter, search])

  const counts = {
    active: rows?.filter((r) => !r.supersededAt).length ?? 0,
    superseded: rows?.filter((r) => r.supersededAt).length ?? 0,
    all: rows?.length ?? 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Outcome Library</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Read-only browse of the global outcome library. Search by title, mode, or instrumentation.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['active', 'superseded', 'all'] as const).map((f) => {
            const on = filter === f
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: on ? T.surfaceRaised : 'transparent',
                  border: `1px solid ${on ? T.accent : T.border}`,
                  color: on ? T.accent : T.textMuted,
                  padding: '6px 14px', borderRadius: 4,
                  fontFamily: T.mono, fontSize: 11, cursor: 'pointer',
                }}
              >{f} ({counts[f]})</button>
            )
          })}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search title, mode, instrumentation"
          style={{
            background: T.surface, border: `1px solid ${T.border}`, color: T.text,
            fontFamily: T.mono, fontSize: 12, padding: '7px 10px', borderRadius: 4,
            outline: 'none', minWidth: 280, flex: 1, maxWidth: 480,
          }}
        />
      </div>

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {!rows && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {rows && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <Header />
          {visible.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>
              no matches
            </div>
          )}
          {visible.map((r) => <Row key={r.id} row={r} />)}
        </div>
      )}
    </div>
  )
}

const COLS = '1.6fr 60px 70px 70px 1.4fr 1.6fr 80px 100px'

function Header() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.mono, fontSize: 10, color: T.textDim, textTransform: 'uppercase',
    }}>
      <span>title</span>
      <span>v</span>
      <span>bpm</span>
      <span>mode</span>
      <span>dynamics</span>
      <span>instrumentation</span>
      <span style={{ textAlign: 'right' }}>pool</span>
      <span style={{ textAlign: 'right' }}>status</span>
    </div>
  )
}

function Row({ row }: { row: Row }) {
  const superseded = !!row.supersededAt
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.mono, fontSize: 11, alignItems: 'center',
      opacity: superseded ? 0.6 : 1,
    }}>
      <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500 }}>{row.title}</span>
      <span style={{ color: T.accentMuted }}>v{row.version}</span>
      <span style={{ color: T.textMuted }}>{row.tempoBpm}</span>
      <span style={{ color: T.textMuted }}>{row.mode}</span>
      <span style={cellTrunc}>{row.dynamics ?? '—'}</span>
      <span style={cellTrunc}>{row.instrumentation ?? '—'}</span>
      <span style={{ color: row.lineageCount === 0 ? T.danger : T.text, textAlign: 'right' }}>{row.lineageCount}</span>
      <span style={{
        textAlign: 'right',
        color: superseded ? T.textDim : T.success,
        fontSize: 10,
      }}>{superseded ? 'superseded' : 'active'}</span>
    </div>
  )
}

const cellTrunc: CSSProperties = {
  color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
