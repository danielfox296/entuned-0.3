import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { LineageRowList, LineageRowFull, OutcomeRowFull } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, PanelHeader, S } from '../../ui/index.js'

type ActiveFilter = 'all' | 'true' | 'false'
const PAGE_SIZE = 50

interface IcpOption { id: string; name: string; clientName: string | null; storeName: string | null }

// Show one row per outcomeKey (latest-version wins) and skip superseded entries.
// Otherwise the dropdown lists "Linger" / "Linger" / "Linger" once per historical version.
function dedupeActiveOutcomes(rows: OutcomeRowFull[]): OutcomeRowFull[] {
  const byKey = new Map<string, OutcomeRowFull>()
  for (const r of rows) {
    if (r.supersededAt) continue
    const cur = byKey.get(r.outcomeKey)
    if (!cur || r.version > cur.version) byKey.set(r.outcomeKey, r)
  }
  return Array.from(byKey.values()).sort((a, b) => (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title))
}

export function SongBrowser({ defaultActive = 'true' as ActiveFilter, headerLabel = 'Song Browser', headerHint = '' }: { defaultActive?: ActiveFilter; headerLabel?: string; headerHint?: string }) {
  const [data, setData] = useState<LineageRowList | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [icps, setIcps] = useState<IcpOption[] | null>(null)
  const [icpId, setIcpId] = useState<string>('')
  const [outcomeId, setOutcomeId] = useState<string>('')
  const [active, setActive] = useState<ActiveFilter>(defaultActive)
  const [page, setPage] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = async (p = page) => {
    const token = getToken(); if (!token) return
    setLoading(true); setErr(null)
    try {
      const r = await api.lineageRows({
        icpId: icpId || undefined,
        outcomeId: outcomeId || undefined,
        active,
        limit: PAGE_SIZE,
        offset: p * PAGE_SIZE,
      }, token)
      setData(r); setPage(p)
    } catch (e: any) { setErr(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomeLibrary(token).then(setOutcomes).catch((e) => setErr(e.message))
    // We don't have a direct ICP list endpoint exposed, but pool-depth carries them.
    api.poolDepth(token).then((r) => setIcps(r.icps.map((i) => ({
      id: i.id, name: i.name,
      clientName: i.clientName,
      storeName: i.stores[0]?.name ?? null,
    })))).catch(() => {})
  }, [])

  useEffect(() => { void reload(0) }, [icpId, outcomeId, active])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader title={headerLabel} subtitle={headerHint} />

      <Filters
        icps={icps} outcomes={outcomes}
        icpId={icpId} outcomeId={outcomeId} active={active}
        onIcp={setIcpId} onOutcome={setOutcomeId} onActive={setActive}
      />

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {loading && !data && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {data && (
        <>
          <div style={{ fontFamily: T.mono, fontSize: 14, color: T.textDim }}>
            {data.total.toLocaleString()} row{data.total === 1 ? '' : 's'}
            {data.total > 0 && ` · showing ${data.offset + 1}–${Math.min(data.offset + data.rows.length, data.total)}`}
          </div>

          <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
            <Header />
            {data.rows.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 14 }}>
                no rows match these filters
              </div>
            )}
            {data.rows.map((r) => (
              <Row key={r.id} row={r} onChanged={() => reload(page)} />
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => reload(page - 1)} disabled={page === 0 || loading}>← prev</Button>
              <span style={{ fontFamily: T.sans, fontSize: S.small, color: T.textDim }}>page {page + 1} / {totalPages}</span>
              <Button variant="ghost" onClick={() => reload(page + 1)} disabled={page >= totalPages - 1 || loading}>next →</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Filters({ icps, outcomes, icpId, outcomeId, active, onIcp, onOutcome, onActive }: {
  icps: IcpOption[] | null; outcomes: OutcomeRowFull[] | null
  icpId: string; outcomeId: string; active: ActiveFilter
  onIcp: (v: string) => void; onOutcome: (v: string) => void; onActive: (v: ActiveFilter) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <FilterSelect label="icp" value={icpId} onChange={onIcp} options={[{ value: '', label: 'all ICPs' }, ...(icps ?? []).map((i) => ({
        value: i.id,
        label: i.clientName ? `${i.name} — ${i.clientName}${i.storeName ? ` · ${i.storeName}` : ''}` : i.name,
      }))]} />
      <FilterSelect label="outcome" value={outcomeId} onChange={onOutcome} options={[{ value: '', label: 'all outcomes' }, ...dedupeActiveOutcomes(outcomes ?? []).map((o) => ({ value: o.id, label: o.displayTitle ?? o.title }))]} />
      <div style={{ display: 'flex', gap: 4 }}>
        {(['true', 'false', 'all'] as const).map((k) => {
          const on = active === k
          const label = k === 'true' ? 'active' : k === 'false' ? 'retired' : 'all'
          return (
            <button key={k} onClick={() => onActive(k)} style={{
              background: on ? T.surfaceRaised : 'transparent',
              border: `1px solid ${on ? T.accent : T.border}`,
              color: on ? T.accent : T.textMuted,
              padding: '5px 12px', borderRadius: 4,
              fontFamily: T.mono, fontSize: 14, cursor: 'pointer',
            }}>{label}</button>
          )
        })}
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        background: T.surface, border: `1px solid ${T.border}`, color: T.text,
        fontFamily: T.mono, fontSize: 14, padding: '5px 8px', borderRadius: 3, outline: 'none',
        minWidth: 160,
      }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

const COLS = '1.4fr 1.2fr 1fr 2fr 90px 110px 110px'

function Header() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase',
    }}>
      <span>icp</span>
      <span>outcome</span>
      <span>hook</span>
      <span>song</span>
      <span>date</span>
      <span style={{ textAlign: 'right' }}>status</span>
      <span style={{ textAlign: 'right' }}>action</span>
    </div>
  )
}

function Row({ row, onChanged }: { row: LineageRowFull; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = async () => {
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try { await api.setLineageRowActive(row.id, !row.active, token); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const play = () => {
    if (audio && !audio.paused) { audio.pause(); setPlaying(false); return }
    if (audio) { audio.play(); setPlaying(true); return }
    const a = new Audio(row.song.r2Url)
    a.onended = () => setPlaying(false)
    a.onpause = () => setPlaying(false)
    a.onplay = () => setPlaying(true)
    a.play().catch((e) => setErr(e.message))
    setAudio(a)
  }

  const created = new Date(row.createdAt).toISOString().slice(0, 10)
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.mono, fontSize: 14, alignItems: 'center',
      opacity: row.active ? 1 : 0.55,
    }}>
      <span style={{ ...trunc, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500, ...trunc }}>{row.icpName ?? row.icpId.slice(0, 8)}</span>
        {(row.clientName || row.storeName) && (
          <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12, ...trunc }}>
            {[row.clientName, row.storeName].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span style={{ color: T.textMuted, ...trunc }}>{row.outcome.displayTitle ?? row.outcome.title}</span>
      <span style={{ color: T.textMuted, fontFamily: T.sans, ...trunc }} title={row.hook.text}>{row.hook.text}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...trunc }}>
        <button onClick={play} style={playBtn(playing)} title={playing ? 'pause' : 'play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <a href={row.song.r2Url} target="_blank" rel="noreferrer" style={{ color: T.accent, fontSize: 13, ...trunc }}>{row.song.id.slice(0, 8)}</a>
      </span>
      <span style={{ color: T.textDim, fontSize: 13 }}>{created}</span>
      <span style={{ textAlign: 'right', color: row.active ? T.success : T.textDim, fontSize: 13, textTransform: 'uppercase' }}>
        {row.active ? 'active' : 'retired'}
      </span>
      <span style={{ textAlign: 'right' }}>
        <button onClick={toggle} disabled={busy} style={row.active ? dangerBtn : restoreBtn}>
          {busy ? '…' : (row.active ? 'retire' : 'restore')}
        </button>
        {err && <div style={{ fontSize: 12, color: T.danger }}>{err}</div>}
      </span>
    </div>
  )
}

const trunc: any = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const dangerBtn: any = {
  background: 'transparent', border: `1px solid ${T.danger}`, color: T.danger,
  padding: '4px 10px', borderRadius: 3, fontFamily: T.mono, fontSize: 13, cursor: 'pointer',
}

const restoreBtn: any = {
  background: 'transparent', border: `1px solid ${T.accent}`, color: T.accent,
  padding: '4px 10px', borderRadius: 3, fontFamily: T.mono, fontSize: 13, cursor: 'pointer',
}

function playBtn(playing: boolean): any {
  return {
    background: playing ? T.accent : 'transparent',
    border: `1px solid ${T.accent}`,
    color: playing ? T.bg : T.accent,
    width: 22, height: 22, borderRadius: 11,
    fontSize: 12, cursor: 'pointer', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
}
