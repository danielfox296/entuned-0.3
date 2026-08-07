import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StationRow, StationUpdate } from '../../api.js'
import { T } from '@entuned/tokens'
import {
  PanelHeader, Button, Input, Textarea, S, useToast,
  useClientSelection, useStoreSelection, useIcpSelection,
} from '../../ui/index.js'

// Stations — the free tier's music choice (Card 23).
//
// A Station owns exactly one ICP; the Station's pool IS that ICP's active
// LineageRow set. That makes this panel two things at once: the catalogue
// editor for the copy free users read in the picker, and the operational view
// of how deep each station's library actually is.
//
// The pool thresholds mirror Pool Depth's (critical < 5, thin < 15) so the two
// panels don't disagree about what "thin" means.
const POOL_CRITICAL = 5
const POOL_THIN = 15

type Draft = StationUpdate

export function Stations() {
  const [rows, setRows] = useState<StationRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = async () => {
    const token = getToken(); if (!token) return
    try { setRows(await api.stations(token)); setErr(null) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { void reload() }, [])

  const emptyPools = (rows ?? []).filter((r) => r.active && r.poolSize === 0).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Stations"
        subtitle="The six shared pools a free-tier location picks between. Each station owns one ICP — generate its music from Workflows, on that ICP. Name and descriptor are what free users read in the picker."
      />

      {err && <div style={{ color: T.danger, fontFamily: T.mono, fontSize: 14 }}>{err}</div>}
      {!rows && !err && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {rows && rows.length === 0 && (
        <div style={emptyStyle}>
          No stations in the catalogue. The six launch stations are seeded by the
          <code style={codeStyle}>20260806120000_add_stations</code> migration — if this is empty, that migration hasn’t run here.
        </div>
      )}

      {rows && emptyPools > 0 && (
        <div style={warnStyle}>
          {emptyPools} active station{emptyPools === 1 ? ' has' : 's have'} an empty pool. Locations on
          {emptyPools === 1 ? ' it' : ' them'} fall back to the general free-tier pool until the first song lands — no silence,
          but also not the station they picked.
        </div>
      )}

      {rows && rows.map((r) => (
        <StationCard key={r.id} row={r} onSaved={reload} />
      ))}
    </div>
  )
}

function StationCard({ row, onSaved }: { row: StationRow; onSaved: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>({})
  const [busy, setBusy] = useState(false)
  const [, setClientId] = useClientSelection()
  const [, setStoreId] = useStoreSelection()
  const [, setIcpId] = useIcpSelection()

  // Drop any unsaved edits when the row is replaced by a fresh fetch.
  useEffect(() => { setDraft({}) }, [row.updatedAt])

  const v = <K extends keyof Draft>(k: K): NonNullable<StationRow[K]> | null =>
    (draft[k] !== undefined ? draft[k] : row[k]) as any
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => setDraft((d) => ({ ...d, [k]: val }))
  const dirty = Object.keys(draft).length > 0

  const save = async () => {
    const token = getToken(); if (!token) return
    setBusy(true)
    try {
      await api.updateStation(row.id, draft, token)
      setDraft({})
      onSaved()
      toast.success(`station "${row.stationKey}" saved`)
    } catch (e: any) {
      toast.error(e.message ?? 'failed to save station')
    } finally { setBusy(false) }
  }

  // Point the whole shell at this station's ICP and land on Reference Tracks —
  // the first step of filling a station's pool. The location selector goes to
  // "all locations" because a station ICP has none.
  const openInWorkflows = (tab: string) => {
    setClientId(row.icpClientId)
    setStoreId(null)
    setIcpId(row.icpId)
    window.location.hash = `workflows/${encodeURIComponent(tab)}`
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  const tone = poolTone(row.poolSize)

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderLeft: `3px solid ${row.active ? toneColor(tone) : T.borderSubtle}`,
      borderRadius: 4, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
      opacity: row.active ? 1 : 0.65,
    }}>
      {/* Row 1 — identity + operational counters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{row.stationKey}</span>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim }}>·</span>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: toneColor(tone) }}>
          {row.poolSize} song{row.poolSize === 1 ? '' : 's'} in pool
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim }}>·</span>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textMuted }}>
          {row.stores.length} location{row.stores.length === 1 ? '' : 's'} listening
        </span>
        {!row.active && (
          <span style={pillStyle(T.textDim)}>inactive — off the picker</span>
        )}
        {row.icpArchived && (
          <span style={pillStyle(T.danger)}>ICP archived</span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => openInWorkflows('Reference Tracks')} style={linkBtnStyle}>reference tracks →</button>
        <button onClick={() => openInWorkflows('Hook Writing')} style={linkBtnStyle}>hooks →</button>
        <button onClick={() => openInWorkflows('Pipeline')} style={linkBtnStyle}>pipeline →</button>
      </div>

      {/* Row 2 — the copy free users read in the picker */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 90px', gap: 12, alignItems: 'start' }}>
        <FieldLabel label="display name" hint="what free users see in the picker">
          <Input value={v('displayName') ?? ''} onChange={(e) => set('displayName', e.target.value)} />
        </FieldLabel>
        <FieldLabel label="subtitle" hint="one line under the name; blank to hide">
          <Input
            value={v('subtitle') ?? ''}
            onChange={(e) => set('subtitle', e.target.value || null)}
            placeholder="—"
          />
        </FieldLabel>
        <FieldLabel label="sort" hint="picker order">
          <Input
            type="number"
            value={String(v('sortOrder') ?? 0)}
            onChange={(e) => set('sortOrder', Number.parseInt(e.target.value, 10) || 0)}
          />
        </FieldLabel>
      </div>

      {/* Row 3 — the generation-side anchor. DB-resident by rule; see apps/server/CLAUDE.md. */}
      <FieldLabel label="genre steering" hint="anchor phrase the generation pipeline builds this station's sound from">
        <Textarea
          rows={2}
          value={v('genreSteering') ?? ''}
          onChange={(e) => set('genreSteering', e.target.value)}
        />
      </FieldLabel>

      {row.stores.length > 0 && (
        <div style={{ fontFamily: T.sans, fontSize: 12, color: T.textDim }}>
          listening: {row.stores.map((s) => `${s.clientName} — ${s.name}`).join(' · ')}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={save} disabled={!dirty} busy={busy}>
          {busy ? 'saving…' : (dirty ? 'save' : 'no changes')}
        </Button>
        {dirty && <Button variant="tiny" onClick={() => setDraft({})}>discard</Button>}
        <div style={{ flex: 1 }} />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: T.sans, fontSize: 13, color: T.textMuted,
        }}>
          <input
            type="checkbox"
            checked={v('active') ?? true}
            onChange={(e) => set('active', e.target.checked)}
            style={{ accentColor: T.accent, width: 16, height: 16 }}
          />
          active
        </label>
        <span style={{ fontFamily: T.sans, fontSize: 11, color: T.textDim, fontStyle: 'italic', maxWidth: 380 }}>
          deactivating removes it from the picker; locations already on it keep playing it
        </span>
      </div>
    </div>
  )
}

function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{
        fontFamily: T.sans, fontSize: 11, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>{label}</label>
      {children}
      {hint && (
        <span style={{ fontFamily: T.sans, fontSize: 11, color: T.textDim, fontStyle: 'italic' }}>{hint}</span>
      )}
    </div>
  )
}

function poolTone(poolSize: number): 'ok' | 'soft' | 'block' {
  if (poolSize < POOL_CRITICAL) return 'block'
  if (poolSize < POOL_THIN) return 'soft'
  return 'ok'
}
function toneColor(tone: 'ok' | 'soft' | 'block'): string {
  return tone === 'ok' ? '#7fdba0' : tone === 'soft' ? '#f59e0b' : T.danger
}

function pillStyle(color: string): CSSProperties {
  return {
    fontFamily: T.mono, fontSize: 10, color,
    border: `1px solid ${color}44`, borderRadius: 2,
    padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '0.05em',
  }
}

const linkBtnStyle: CSSProperties = {
  background: 'transparent', border: 'none', color: T.accent,
  fontFamily: T.mono, fontSize: 12, cursor: 'pointer', padding: '2px 4px',
  textDecoration: 'underline', textUnderlineOffset: 3,
}

const emptyStyle: CSSProperties = {
  background: T.surfaceRaised, border: `1px dashed ${T.borderSubtle}`,
  borderRadius: 4, padding: '14px 18px',
  fontFamily: T.sans, fontSize: 14, color: T.textMuted, lineHeight: 1.6,
}

const warnStyle: CSSProperties = {
  background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)',
  borderRadius: 4, padding: '12px 16px',
  fontFamily: T.sans, fontSize: 13, color: T.textMuted, lineHeight: 1.6,
}

const codeStyle: CSSProperties = {
  fontFamily: T.mono, fontSize: 12, color: T.text,
  background: T.bg, padding: '1px 5px', borderRadius: 3, margin: '0 4px',
}
