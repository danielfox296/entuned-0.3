import { useEffect, useRef, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { LineageRowList, LineageRowFull, OutcomeRowFull, SongSeedDetail } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, PanelHeader, S } from '../../ui/index.js'

type ActiveFilter = 'all' | 'true' | 'false'
type GeneralFilter = 'hide' | 'only' | 'all'
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
  const [general, setGeneral] = useState<GeneralFilter>('hide')
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
        general,
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

  useEffect(() => { void reload(0) }, [icpId, outcomeId, active, general])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader title={headerLabel} subtitle={headerHint} />

      <Filters
        icps={icps} outcomes={outcomes}
        icpId={icpId} outcomeId={outcomeId} active={active} general={general}
        onIcp={setIcpId} onOutcome={setOutcomeId} onActive={setActive} onGeneral={setGeneral}
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
                No rows match these filters
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

function Filters({ icps, outcomes, icpId, outcomeId, active, general, onIcp, onOutcome, onActive, onGeneral }: {
  icps: IcpOption[] | null; outcomes: OutcomeRowFull[] | null
  icpId: string; outcomeId: string; active: ActiveFilter; general: GeneralFilter
  onIcp: (v: string) => void; onOutcome: (v: string) => void
  onActive: (v: ActiveFilter) => void; onGeneral: (v: GeneralFilter) => void
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
      <span style={{ fontSize: 13, color: T.textDim, fontFamily: T.mono, textTransform: 'uppercase' }}>free</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['hide', 'only', 'all'] as const).map((k) => {
          const on = general === k
          return (
            <button key={k} onClick={() => onGeneral(k)} style={{
              background: on ? T.surfaceRaised : 'transparent',
              border: `1px solid ${on ? T.accent : T.border}`,
              color: on ? T.accent : T.textMuted,
              padding: '5px 12px', borderRadius: 4,
              fontFamily: T.mono, fontSize: 14, cursor: 'pointer',
            }} title={k === 'hide' ? 'hide free-pool rows' : k === 'only' ? 'show only free-pool rows' : 'show both'}>{k}</button>
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

const COLS = '1.6fr 1.8fr 1.1fr 1.3fr 110px 60px 50px 50px 60px 110px'

// Module-level: only one row can play at a time across the browser.
let currentAudio: HTMLAudioElement | null = null

function Header() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase',
    }}>
      <span>song</span>
      <span>hook</span>
      <span>outcome</span>
      <span>icp</span>
      <span>create date</span>
      <span style={{ textAlign: 'right' }}>time</span>
      <span style={{ textAlign: 'right' }} title="Total ♥ across all stores">love</span>
      <span style={{ textAlign: 'right' }} title="Total reports across all stores">flag</span>
      <span style={{ textAlign: 'center' }} title="In the free-tier general pool">free</span>
      <span style={{ textAlign: 'right' }}>status</span>
    </div>
  )
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return '–:––'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function Row({ row, onChanged }: { row: LineageRowFull; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [generalBusy, setGeneralBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [seedDetail, setSeedDetail] = useState<SongSeedDetail | null>(null)
  const [seedErr, setSeedErr] = useState<string | null>(null)
  const [seedLoading, setSeedLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const a = new Audio()
    a.preload = 'metadata'
    a.src = row.song.r2Url
    a.onloadedmetadata = () => setDuration(a.duration)
    a.onended = () => { setPlaying(false); if (currentAudio === a) currentAudio = null }
    a.onpause = () => { setPlaying(false); if (currentAudio === a) currentAudio = null }
    a.onplay = () => setPlaying(true)
    audioRef.current = a
    return () => {
      a.pause()
      if (currentAudio === a) currentAudio = null
    }
  }, [row.song.r2Url])

  const setStatus = async (val: 'active' | 'retired') => {
    const newActive = val === 'active'
    if (newActive === row.active) return
    const token = getToken(); if (!token) return
    setBusy(true); setErr(null)
    try { await api.setLineageRowActive(row.id, newActive, token); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const toggleGeneral = async () => {
    const token = getToken(); if (!token) return
    setGeneralBusy(true); setErr(null)
    try { await api.toggleLineageRowGeneral(row.id, token); onChanged() }
    catch (e: any) { setErr(e.message) }
    finally { setGeneralBusy(false) }
  }

  const play = () => {
    const a = audioRef.current
    if (!a) return
    if (!a.paused) { a.pause(); return }
    if (currentAudio && currentAudio !== a) currentAudio.pause()
    currentAudio = a
    a.play().catch((e) => setErr(e.message))
  }

  const toggleExpanded = () => {
    const next = !expanded
    setExpanded(next)
    if (next && row.songSeedId && !seedDetail && !seedLoading) {
      const token = getToken(); if (!token) return
      setSeedLoading(true); setSeedErr(null)
      api.songSeedDetail(row.songSeedId, token)
        .then(setSeedDetail)
        .catch((e: any) => setSeedErr(e.message))
        .finally(() => setSeedLoading(false))
    }
  }

  const created = new Date(row.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  return (
    <div style={{ borderBottom: `1px solid ${T.borderSubtle}`, opacity: row.active ? 1 : 0.55 }}>
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '10px 12px',
      fontFamily: T.mono, fontSize: 14, alignItems: 'flex-start',
    }}>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        <button
          onClick={play}
          style={playBtn(playing)}
          title={playing ? 'pause' : `play — ${row.songTitle ?? 'untitled'}`}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span
          onClick={toggleExpanded}
          style={{ color: T.text, fontWeight: 700, cursor: 'pointer', fontFamily: T.sans, wordBreak: 'break-word', overflowWrap: 'anywhere', lineHeight: 1.3 }}
          title={expanded ? 'hide details' : 'show details'}
        >{expanded ? '▾ ' : '▸ '}{row.songTitle ?? '(untitled)'}</span>
      </span>
      <span style={{ color: T.text, fontFamily: T.sans, lineHeight: 1.3, wordBreak: 'break-word', overflowWrap: 'anywhere' }} title={row.hook?.text ?? '— general pool —'}>
        {row.hook?.text ?? <span style={{ color: T.textDim, fontStyle: 'italic' }}>— general pool —</span>}
      </span>
      <span style={{ color: T.textMuted, ...trunc }}>{row.outcome.displayTitle ?? row.outcome.title}</span>
      <span style={{ ...trunc, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500, ...trunc }}>
          {row.icpName ?? (row.icpId ? row.icpId.slice(0, 8) : <span style={{ color: T.textDim, fontStyle: 'italic' }}>free tier</span>)}
        </span>
        {(row.clientName || row.storeName) && (
          <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: 12, ...trunc }}>
            {[row.clientName, row.storeName].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span style={{ color: T.textDim, fontSize: 13 }}>{created}</span>
      <span style={{ textAlign: 'right', color: T.textMuted, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        {fmtDuration(duration)}
      </span>
      <span style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: row.loveCount > 0 ? T.accent : T.textDim }}>
        {row.loveCount}
      </span>
      <span style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: row.reportCount > 0 ? T.danger : T.textDim }}>
        {row.reportCount}
      </span>
      <span style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={row.inGeneralPool}
          disabled={generalBusy}
          onChange={toggleGeneral}
          title={row.inGeneralPool
            ? 'Remove this song+outcome from the free-tier general pool'
            : 'Add this song+outcome to the free-tier general pool'}
          style={{ accentColor: T.accent, cursor: generalBusy ? 'wait' : 'pointer', width: 16, height: 16 }}
        />
      </span>
      <span style={{ textAlign: 'right' }}>
        <select
          value={row.active ? 'active' : 'retired'}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value as 'active' | 'retired')}
          style={{
            background: T.surface,
            border: `1px solid ${row.active ? T.accent : T.border}`,
            color: row.active ? T.accent : T.textMuted,
            fontFamily: T.mono, fontSize: 13, padding: '4px 8px', borderRadius: 3,
            cursor: busy ? 'wait' : 'pointer', outline: 'none', textTransform: 'uppercase',
          }}
        >
          <option value="active">active</option>
          <option value="retired">retired</option>
        </select>
        {err && <div style={{ fontSize: 12, color: T.danger }}>{err}</div>}
      </span>
    </div>
    {expanded && (
      <DetailPanel
        row={row}
        seedDetail={seedDetail}
        seedErr={seedErr}
        seedLoading={seedLoading}
      />
    )}
    </div>
  )
}

function DetailPanel({ row, seedDetail, seedErr, seedLoading }: {
  row: LineageRowFull
  seedDetail: SongSeedDetail | null
  seedErr: string | null
  seedLoading: boolean
}) {
  const byteSize = row.song.byteSize == null ? null : Number(row.song.byteSize)
  const sizeKb = byteSize == null ? null : Math.round(byteSize / 1024)
  const uploadedAt = new Date(row.song.uploadedAt).toLocaleString()
  return (
    <div style={{
      padding: '14px 18px 18px 38px',
      background: T.surface,
      borderTop: `1px solid ${T.borderSubtle}`,
      fontFamily: T.mono, fontSize: 13, color: T.textMuted,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <Section title="Audio">
        <UrlField label="r2 url" value={row.song.r2Url} />
        <Field label="r2 object key" value={row.song.r2ObjectKey} />
        <Field label="song id" value={row.song.id} mono />
        <Field label="size" value={sizeKb == null ? '—' : `${sizeKb.toLocaleString()} KB`} />
        <Field label="content type" value={row.song.contentType ?? '—'} />
        <Field label="uploaded" value={uploadedAt} />
      </Section>

      <Section title="Lineage">
        <Field label="lineage row id" value={row.id} mono />
        <Field label="outcome" value={`${row.outcome.displayTitle ?? row.outcome.title} (v${row.outcome.version})`} />
        <Field label="outcome id" value={row.outcome.id} mono />
        <Field label="hook" value={row.hook?.text ?? '— general pool —'} />
        {row.hook && <Field label="hook id" value={row.hook.id} mono />}
        <Field label="icp" value={row.icpName ?? row.icpId ?? '—'} />
        {row.icpId && <Field label="icp id" value={row.icpId} mono />}
        <Field label="client" value={row.clientName ?? '—'} />
        <Field label="store" value={row.storeName ?? '—'} />
      </Section>

      {row.songSeedId && (
        <Section title="Seed prompt">
          <Field label="seed id" value={row.songSeedId} mono />
          {seedLoading && <div style={{ color: T.textDim }}>loading seed…</div>}
          {seedErr && <div style={{ color: T.danger }}>{seedErr}</div>}
          {seedDetail && (
            <>
              <Field label="status" value={seedDetail.status} />
              <Field label="title" value={seedDetail.title ?? '—'} />
              <Field label="vocal gender" value={seedDetail.vocalGender ?? '—'} />
              <Field label="style" value={seedDetail.style ?? '—'} multiline />
              <Field label="negative style" value={seedDetail.negativeStyle ?? '—'} multiline />
              <Field label="lyrics" value={seedDetail.lyrics ?? '—'} multiline />
            </>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        fontFamily: T.mono, fontSize: 11, color: T.textDim,
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', columnGap: 14, rowGap: 4 }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, mono, multiline }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  return (
    <>
      <div style={{ color: T.textDim, fontSize: 12 }}>{label}</div>
      <div style={{
        color: T.text,
        fontFamily: mono ? T.mono : T.sans,
        fontSize: 13,
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
        wordBreak: 'break-word',
      }}>{value}</div>
    </>
  )
}

function UrlField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <>
      <div style={{ color: T.textDim, fontSize: 12 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          style={{ color: T.accent, fontFamily: T.mono, fontSize: 13, wordBreak: 'break-all', textDecoration: 'none' }}
        >{value}</a>
        <button
          onClick={copy}
          style={{
            background: 'transparent', border: `1px solid ${T.border}`,
            color: copied ? T.accent : T.textMuted,
            fontFamily: T.mono, fontSize: 11, padding: '2px 8px', borderRadius: 3,
            cursor: 'pointer', flexShrink: 0,
          }}
          title="copy to clipboard"
        >{copied ? 'copied' : 'copy'}</button>
      </div>
    </>
  )
}

const trunc: any = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

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
