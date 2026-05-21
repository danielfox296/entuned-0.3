import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type {
  SongSeedRow,
  SeedBuilderResult,
  SongCreationQueueInventory,
  SongCreationQueueOutcomeRow,
} from '../../api.js'
import { T } from '@entuned/tokens'
import { Modal, S } from '../../ui/index.js'
import { SongSeed } from './SongSeed.js'
import type { WorkflowContext } from '../workflow/WorkflowRouter.js'

type StyleBuilder = 'router' | 'anchor' | 'legacy'

type RowState =
  | 'ready'
  | 'needs_hooks'
  | 'needs_refs'
  | 'building'
  | 'idle'

function classify(row: SongCreationQueueOutcomeRow, refTracksReady: number): RowState {
  const inFlight = row.seedsAssembling + row.seedsQueued
  if (row.hooksAvailable === 0 && row.hooksApproved === 0 && row.hooksDraft === 0 && inFlight === 0 && row.seedsAccepted === 0) {
    return 'idle'
  }
  if (row.hooksAvailable === 0) return 'needs_hooks'
  if (refTracksReady === 0) return 'needs_refs'
  if (inFlight > 0) return 'building'
  return 'ready'
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const now = Date.now()
  const min = Math.round((now - then) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

export function SongSeedQueue({ ctx }: { ctx: WorkflowContext }) {
  const { storeId, store, icpId } = ctx
  const [inv, setInv] = useState<SongCreationQueueInventory | null>(null)
  const [songSeeds, setSongSeeds] = useState<SongSeedRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busyOutcome, setBusyOutcome] = useState<Record<string, boolean>>({})
  const [optimistic, setOptimistic] = useState<Record<string, number>>({})
  const [lastResult, setLastResult] = useState<{ outcomeId: string; res: SeedBuilderResult } | null>(null)
  const [batchSize, setBatchSize] = useState<Record<string, number>>({})

  const [styleBuilder, setStyleBuilder] = useState<StyleBuilder>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('songSeedQueue.styleBuilder') : null
    if (saved === 'router' || saved === 'anchor' || saved === 'legacy') return saved
    return 'router'
  })

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('songSeedQueue.styleBuilder', styleBuilder)
  }, [styleBuilder])

  const storeIcps = store?.icps ?? []

  const reload = useCallback(async () => {
    if (!icpId) { setInv(null); setSongSeeds(null); return }
    const token = getToken(); if (!token) return
    try {
      const [invRes, seeds] = await Promise.all([
        api.songCreationQueueInventory(icpId, token),
        api.songSeeds(token, { icpId, status: 'queued', limit: 100 }),
      ])
      setInv(invRes)
      setSongSeeds(seeds)
      setOptimistic({})
      setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [icpId])

  useEffect(() => { reload() }, [reload])

  const generate = useCallback(async (outcomeId: string, n: number) => {
    if (!icpId) return
    const token = getToken(); if (!token) return
    setBusyOutcome((b) => ({ ...b, [outcomeId]: true }))
    setOptimistic((o) => ({ ...o, [outcomeId]: (o[outcomeId] ?? 0) + n }))
    setErr(null)
    setLastResult(null)
    try {
      const res = await api.runSeedBuilder({ icpId, outcomeId, n, styleBuilder }, token)
      setLastResult({ outcomeId, res })
      await reload()
    } catch (e: any) {
      setErr(e.message)
      setOptimistic((o) => ({ ...o, [outcomeId]: Math.max(0, (o[outcomeId] ?? 0) - n) }))
    } finally {
      setBusyOutcome((b) => ({ ...b, [outcomeId]: false }))
    }
  }, [icpId, styleBuilder, reload])

  const navTo = (sub: string, pendingOutcomeId?: string) => {
    // Hand the destination panel a hint via sessionStorage so it can pre-select
    // the outcome we were just looking at. The destination panel reads + clears
    // this on mount. Keeps URL clean while making deep-links land somewhere useful.
    if (pendingOutcomeId && typeof window !== 'undefined') {
      window.sessionStorage.setItem('workflow.pendingOutcomeId', pendingOutcomeId)
    }
    window.location.hash = `workflows/${encodeURIComponent(sub)}`
  }

  const totals = useMemo(() => {
    if (!inv) return null
    let hooksAvailable = 0, hooksDraft = 0, seedsQueued = 0, seedsAccepted = 0, seedsAssembling = 0
    for (const o of inv.outcomes) {
      hooksAvailable += o.hooksAvailable
      hooksDraft += o.hooksDraft
      seedsQueued += o.seedsQueued
      seedsAccepted += o.seedsAccepted
      seedsAssembling += o.seedsAssembling
    }
    return { hooksAvailable, hooksDraft, seedsQueued, seedsAccepted, seedsAssembling }
  }, [inv])

  // Pipeline only renders outcomes you can build from right now. Outcomes in
  // any other state (no hooks, no refs, untouched) belong to the upstream tabs
  // that own those problems — mixing them here clutters this surface.
  const { buildable, needsHooksCount, needsRefsCount } = useMemo(() => {
    if (!inv) return { buildable: [], needsHooksCount: 0, needsRefsCount: 0 }
    const buildable: SongCreationQueueOutcomeRow[] = []
    let needsHooksCount = 0
    let needsRefsCount = 0
    for (const o of inv.outcomes) {
      const state = classify(o, inv.refTracksReady)
      if (state === 'ready' || state === 'building') buildable.push(o)
      else if (state === 'needs_hooks') needsHooksCount++
      else if (state === 'needs_refs') needsRefsCount++
    }
    buildable.sort((a, b) => {
      const inflightA = a.seedsAssembling + a.seedsQueued
      const inflightB = b.seedsAssembling + b.seedsQueued
      if (inflightB !== inflightA) return inflightB - inflightA
      if (b.hooksAvailable !== a.hooksAvailable) return b.hooksAvailable - a.hooksAvailable
      return (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title)
    })
    return { buildable, needsHooksCount, needsRefsCount }
  }, [inv])

  if (!storeId) return <div style={infoBox}>pick a client and location above to begin</div>
  if (storeIcps.length === 0) return <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 14 }}>this location has no ICPs yet — create one in the ICP Editor first</div>
  if (!icpId) return <div style={infoBox}>pick an ICP above to see the pipeline</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      {/* Header: minimal totals + strategy toggle */}
      <div style={headerBar}>
        {totals && (
          <div style={{ fontSize: 13, color: T.textMuted, fontFamily: T.mono }}>
            <span style={{ color: T.text }}>{totals.seedsAccepted}</span> accepted ·{' '}
            <span style={{ color: T.text }}>{totals.seedsQueued}</span> queued for review
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Segmented
            value={styleBuilder}
            onChange={setStyleBuilder}
            options={[
              { value: 'router', label: 'Descriptive', help: 'Long technical description of the track. Current default.' },
              { value: 'anchor', label: 'Anchor', help: 'Genre tag + surgical corrections + curated negative-style ("Anchor-and-Carve"). Short, genre-led.' },
              { value: 'legacy', label: 'Raw', help: 'Concatenates the decomp prose fields with no shaping. Oldest approach.' },
            ]}
          />
          <button onClick={reload} style={ghostBtn}>refresh</button>
        </div>
      </div>

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {!inv && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>loading…</div>}

      {/* Empty state: nothing to build. Tell the user where to go, don't list things here. */}
      {inv && buildable.length === 0 && (
        <div style={infoBox}>
          Nothing ready to build for this ICP.{' '}
          {(inv.refTracksReady === 0)
            ? <>This ICP has no decomposed reference tracks — add some in the <a onClick={() => navTo('Reference Tracks')} style={linkStyle}>Reference Tracks</a> tab.</>
            : <>Approve some hooks in the <a onClick={() => navTo('Hook Writing')} style={linkStyle}>Hook Writing</a> tab to unlock outcomes.</>}
        </div>
      )}

      {/* Buildable outcomes — wrapping grid, compact cards. */}
      {inv && buildable.length > 0 && (
        <div style={cardGridStyle}>
          {buildable.map((o) => (
            <OutcomeCard
              key={o.id}
              row={o}
              busy={!!busyOutcome[o.id]}
              optimisticInflight={optimistic[o.id] ?? 0}
              lastResult={lastResult?.outcomeId === o.id ? lastResult.res : null}
              batchSize={batchSize[o.id] ?? 1}
              onBatchSizeChange={(n) => setBatchSize((b) => ({ ...b, [o.id]: n }))}
              onGenerate={generate}
            />
          ))}
        </div>
      )}

      {/* Quiet footer noting what's blocked elsewhere — signal, not action menu. */}
      {inv && buildable.length > 0 && (needsHooksCount > 0 || needsRefsCount > 0) && (
        <div style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {needsHooksCount > 0 && (
            <span>
              {needsHooksCount} outcome{needsHooksCount === 1 ? '' : 's'} need hooks →{' '}
              <a onClick={() => navTo('Hook Writing')} style={linkStyle}>Hook Writing</a>
            </span>
          )}
          {needsRefsCount > 0 && (
            <span>
              {needsRefsCount} outcome{needsRefsCount === 1 ? '' : 's'} need ref tracks →{' '}
              <a onClick={() => navTo('Reference Tracks')} style={linkStyle}>Reference Tracks</a>
            </span>
          )}
        </div>
      )}

      {/* Queued seeds list */}
      {songSeeds && songSeeds.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, color: T.textMuted, fontFamily: T.mono, marginBottom: 8 }}>
            {songSeeds.length} prompt{songSeeds.length === 1 ? '' : 's'} queued — click to review
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {songSeeds.map((s) => <SeedListRow key={s.id} sub={s} onOpen={() => setOpenId(s.id)} />)}
          </div>
        </div>
      )}

      <Modal
        open={!!openId}
        onClose={() => { setOpenId(null); reload() }}
        title="Song Prompt"
        width={920}
      >
        {openId && (
          <SongSeed
            songSeedId={openId}
            onClose={() => { setOpenId(null); reload() }}
            embedded
          />
        )}
      </Modal>
    </div>
  )
}

function OutcomeCard({
  row, busy, optimisticInflight, lastResult,
  batchSize, onBatchSizeChange, onGenerate,
}: {
  row: SongCreationQueueOutcomeRow
  busy: boolean
  optimisticInflight: number
  lastResult: SeedBuilderResult | null
  batchSize: number
  onBatchSizeChange: (n: number) => void
  onGenerate: (outcomeId: string, n: number) => void
}) {
  const building = row.seedsAssembling + row.seedsQueued + optimisticInflight
  const name = row.displayTitle ?? row.title
  const max = Math.min(20, Math.max(1, row.hooksAvailable || 1))
  const n = Math.min(Math.max(1, batchSize), max)

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 14, color: T.text, fontFamily: T.sans, fontWeight: 500, marginBottom: 8 }}>
        {name}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
        <Stat label="hooks ready" value={row.hooksAvailable} />
        {building > 0 && <Stat label="building" value={building} accent />}
        {row.seedsAccepted > 0 && <Stat label="accepted" value={row.seedsAccepted} />}
        <Stat label="last build" value={relTime(row.lastBatchAt)} />
      </div>

      {lastResult && (
        <div style={{
          fontSize: 11, fontFamily: T.mono,
          color: lastResult.errors.length > 0 ? T.danger : T.textMuted,
          marginBottom: 10,
        }}>
          built {lastResult.producedN}/{lastResult.requestedN}
          {lastResult.errors.length > 0 && ` — ${lastResult.errors.join('; ')}`}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <input
          type="number"
          min={1}
          max={max}
          value={n}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (Number.isFinite(v)) onBatchSizeChange(Math.min(Math.max(1, v), max))
          }}
          style={numberInputStyle}
          title={`up to ${max}`}
          disabled={busy}
        />
        <button
          disabled={busy || row.hooksAvailable < 1}
          onClick={() => onGenerate(row.id, n)}
          style={primaryBtn(row.hooksAvailable >= 1, busy)}
        >{busy ? 'building…' : 'build'}</button>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: T.mono }}>
      <span style={{ color: T.textDim }}>{label}</span>
      <span style={{ color: accent ? T.accent : T.textMuted }}>{value}</span>
    </div>
  )
}

function Segmented({ value, onChange, options }: {
  value: StyleBuilder
  onChange: (v: StyleBuilder) => void
  options: { value: StyleBuilder; label: string; help?: string }[]
}) {
  return (
    <div style={{
      display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 4,
      background: T.surface, overflow: 'hidden',
    }}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.help}
            style={{
              background: on ? T.accent : 'transparent',
              color: on ? T.bg : T.textMuted,
              border: 'none', padding: '6px 12px', cursor: on ? 'default' : 'pointer',
              fontFamily: T.mono, fontSize: 12, fontWeight: on ? 600 : 400,
              borderLeft: i > 0 ? `1px solid ${T.border}` : 'none',
            }}
          >{o.label}</button>
        )
      })}
    </div>
  )
}

function SeedListRow({ sub, onOpen }: { sub: SongSeedRow; onOpen: () => void }) {
  const ref = sub.referenceTrack
  const outcomeName = sub.outcome.displayTitle ?? sub.outcome.title
  return (
    <div
      onClick={onOpen}
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '12px 16px', cursor: 'pointer',
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontFamily: T.mono, fontWeight: 600, color: T.accent,
            background: T.accentGlow, border: `1px solid ${T.accentMuted}`,
            borderRadius: 3, padding: '2px 7px', whiteSpace: 'nowrap', flexShrink: 0,
          }}>{outcomeName}</span>
          <span style={{
            fontSize: 14, fontFamily: T.sans, color: T.text, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{sub.hook.text}</span>
        </div>
        {sub.title && sub.title !== sub.hook.text && (
          <span style={{
            fontSize: 12, fontFamily: T.mono, color: T.textDim, paddingLeft: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{sub.title}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {ref?.coverUrl ? (
          <img
            src={ref.coverUrl}
            alt={`${ref.artist} — ${ref.title}`}
            title={`${ref.artist} — ${ref.title}`}
            style={{
              width: 36, height: 36, borderRadius: 3, objectFit: 'cover',
              border: `1px solid ${T.borderSubtle}`, display: 'block',
            }}
          />
        ) : (
          <div
            title={ref ? `${ref.artist} — ${ref.title}` : 'no reference track'}
            style={{
              width: 36, height: 36, borderRadius: 3,
              background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: T.mono, fontSize: 10, color: T.textDim,
            }}
          >{ref ? '♪' : '—'}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 160 }}>
          <span style={{
            fontSize: 12, fontFamily: T.sans, color: T.textMuted, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{ref ? ref.title : '—'}</span>
          {ref && (
            <span style={{
              fontSize: 11, fontFamily: T.mono, color: T.textDim,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{ref.artist}</span>
          )}
        </div>
      </div>
    </div>
  )
}

const infoBox: CSSProperties = {
  background: T.surfaceRaised, border: `1px solid ${T.border}`,
  borderRadius: 4, padding: '14px 18px', color: T.textMuted,
  fontFamily: T.sans, fontSize: 14,
}

const headerBar: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 16, flexWrap: 'wrap',
}

const cardGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 12,
}

const cardStyle: CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderLeft: `3px solid ${T.accent}`,
  borderRadius: 4,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 140,
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 4, padding: '7px 14px',
    fontFamily: T.mono, fontSize: 13, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
    minWidth: 64,
  }
}

const numberInputStyle: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 13, padding: '6px 8px', borderRadius: 4,
  width: 56, outline: 'none', textAlign: 'center', boxSizing: 'border-box',
}

const ghostBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '5px 12px', borderRadius: 3, fontFamily: T.mono, fontSize: 13, cursor: 'pointer',
}

const linkStyle: CSSProperties = {
  color: T.accent, textDecoration: 'underline', cursor: 'pointer',
}

