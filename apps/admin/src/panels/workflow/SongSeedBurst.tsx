import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type {
  HookRowFull, OutcomeRowFull, ReferenceTrackRow, SongSeedRow,
  StoreDetail, SeedBuilderResult,
} from '../../api.js'
import { T } from '../../tokens.js'
import { Button, S, useToast, LlmProgress } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

const DEFAULT_N = 5
/** Rough per-seed time on the server: Mars + lyrics + style assembly. */
const SECONDS_PER_SEED = 20

type Readiness = {
  approvedHooks: number
  analyzedRefTracks: number
  ready: boolean
}

export function SongSeedBurst({ ctx }: { ctx: WorkflowContext }) {
  const toast = useToast()
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [hooks, setHooks] = useState<HookRowFull[] | null>(null)
  const [refTracks, setRefTracks] = useState<ReferenceTrackRow[] | null>(null)
  const [seeds, setSeeds] = useState<SongSeedRow[] | null>(null)
  const [selectedOutcomeIds, setSelectedOutcomeIds] = useState<Set<string>>(new Set())
  const [activeOutcomeId, setActiveOutcomeId] = useState<string | null>(null)
  const [n, setN] = useState(DEFAULT_N)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [lastResult, setLastResult] = useState<Record<string, SeedBuilderResult>>({})
  const [err, setErr] = useState<string | null>(null)

  // Load outcomes once.
  useEffect(() => {
    const token = getToken(); if (!token) return
    api.outcomes(token).then(setOutcomes).catch((e) => setErr(e.message))
  }, [])

  // Reset workspace when ICP changes.
  useEffect(() => {
    setSelectedOutcomeIds(new Set())
    setActiveOutcomeId(null)
    setLastResult({})
  }, [ctx.icpId])

  const refetchData = async () => {
    if (!ctx.icpId || !ctx.storeId) return
    const token = getToken(); if (!token) return
    try {
      const [hooksRes, storeRes, seedsRes] = await Promise.all([
        api.icpHooks(ctx.icpId, token),
        api.storeDetail(ctx.storeId, token),
        api.songSeeds(token, { icpId: ctx.icpId, limit: 200 }),
      ])
      setHooks(hooksRes)
      const icp = (storeRes as StoreDetail).icps.find((i) => i.id === ctx.icpId)
      setRefTracks(icp?.referenceTracks ?? [])
      setSeeds(seedsRes)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    if (!ctx.icpId) { setHooks(null); setRefTracks(null); setSeeds(null); return }
    refetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.icpId, ctx.storeId])

  const readinessByOutcome = useMemo(() => {
    const m: Record<string, Readiness> = {}
    const approvedHookCount: Record<string, number> = {}
    for (const h of hooks ?? []) {
      if (h.status !== 'approved') continue
      approvedHookCount[h.outcomeId] = (approvedHookCount[h.outcomeId] ?? 0) + 1
    }
    const analyzedRefCount = (refTracks ?? []).filter(
      (t) => t.status === 'approved' && t.styleAnalysis,
    ).length
    for (const o of outcomes ?? []) {
      const a = approvedHookCount[o.id] ?? 0
      m[o.id] = { approvedHooks: a, analyzedRefTracks: analyzedRefCount, ready: a > 0 && analyzedRefCount > 0 }
    }
    return m
  }, [hooks, refTracks, outcomes])

  const seedsByOutcome = useMemo(() => {
    const m: Record<string, SongSeedRow[]> = {}
    for (const s of seeds ?? []) (m[s.outcomeId] ??= []).push(s)
    return m
  }, [seeds])

  const liveOutcomes = (outcomes ?? []).filter((o) => !o.supersededAt)
  const ordered = liveOutcomes.slice().sort((a, b) =>
    (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title),
  )
  const activeOutcome = activeOutcomeId
    ? liveOutcomes.find((o) => o.id === activeOutcomeId) ?? null
    : null
  const selectedList = ordered.filter((o) => selectedOutcomeIds.has(o.id))

  const toggleOutcome = (id: string) => {
    setSelectedOutcomeIds((prev) => {
      const next = new Set(prev)
      const wasSelected = next.has(id)
      if (wasSelected) next.delete(id); else next.add(id)
      if (!wasSelected) {
        setActiveOutcomeId(id)
      } else if (activeOutcomeId === id) {
        const fallback = next.values().next().value ?? null
        setActiveOutcomeId(fallback)
      }
      return next
    })
  }

  const run = async (outcomeId: string) => {
    if (!ctx.icpId) return
    const token = getToken(); if (!token) return
    setRunning((s) => new Set(s).add(outcomeId))
    setErr(null)
    try {
      const result = await api.runSeedBuilder({ icpId: ctx.icpId, outcomeId, n }, token)
      setLastResult((m) => ({ ...m, [outcomeId]: result }))
      await refetchData()
      const reasonNote =
        result.reason === 'pool_exhausted' ? ' (pool exhausted)'
        : result.reason === 'precheck_failed' ? ' (precheck failed)' : ''
      if (result.producedN > 0) {
        toast.success(`created ${result.producedN} of ${result.requestedN} Song Prompt${result.requestedN === 1 ? '' : 's'}${reasonNote}`)
      } else {
        toast.error(`no Song Prompts created${reasonNote}`)
      }
    } catch (e: any) {
      setErr(e.message ?? 'batch failed')
      toast.error(e.message ?? 'Song Prompt batch failed')
    } finally {
      setRunning((s) => { const next = new Set(s); next.delete(outcomeId); return next })
    }
  }

  if (!ctx.icpId) {
    return (
      <div style={{
        background: T.surfaceRaised, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '14px 18px', color: T.textMuted,
        fontFamily: T.sans, fontSize: 14,
      }}>
        select a store and ICP above to begin
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Outcome picker */}
      <div>
        <Heading>Select outcomes to use</Heading>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 8, marginTop: 10,
        }}>
          {ordered.map((o) => {
            const on = selectedOutcomeIds.has(o.id)
            const r = readinessByOutcome[o.id]
            const seedsForOutcome = seedsByOutcome[o.id] ?? []
            const inFlight = seedsForOutcome.filter((s) => s.status === 'assembling' || s.status === 'queued').length
            const accepted = seedsForOutcome.filter((s) => s.status === 'accepted').length
            return (
              <button
                key={o.id}
                onClick={() => toggleOutcome(o.id)}
                style={{
                  textAlign: 'left',
                  background: on ? T.accentGlow : T.surfaceRaised,
                  border: `1px solid ${on ? T.accent : T.border}`,
                  borderRadius: 4, padding: '10px 12px', cursor: 'pointer',
                  fontFamily: T.sans,
                }}
              >
                <div style={{ fontSize: 14, color: T.text, fontWeight: on ? 500 : 400 }}>
                  {o.displayTitle ?? o.title}
                </div>
                <div style={{
                  fontSize: 12, color: T.textDim, marginTop: 4, fontFamily: T.mono,
                  display: 'flex', flexWrap: 'wrap', gap: 6,
                }}>
                  <span>{r?.approvedHooks ?? 0} hook{r?.approvedHooks === 1 ? '' : 's'}</span>
                  <span>·</span>
                  <span>{inFlight} to work</span>
                  <span>·</span>
                  <span>{accepted} accepted</span>
                </div>
                {r && !r.ready && (
                  <div style={{
                    fontSize: 11, color: T.danger, marginTop: 4, fontFamily: T.mono,
                  }}>
                    {r.approvedHooks === 0 ? 'no approved hooks' : 'no decomposed ref tracks'}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selectedList.length > 0 && (
        <>
          {/* Active outcome tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, borderBottom: `1px solid ${T.borderSubtle}` }}>
            {selectedList.map((o) => {
              const on = activeOutcomeId === o.id
              return (
                <button
                  key={o.id}
                  onClick={() => setActiveOutcomeId(o.id)}
                  style={{
                    background: 'transparent', border: 'none',
                    borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                    color: on ? T.text : T.textMuted,
                    padding: '8px 14px', cursor: 'pointer',
                    fontFamily: T.sans, fontSize: 14, fontWeight: on ? 500 : 400,
                    marginBottom: -1,
                  }}
                >{o.displayTitle ?? o.title}</button>
              )
            })}
          </div>

          {activeOutcome && (
            <BurstSurface
              outcome={activeOutcome}
              readiness={readinessByOutcome[activeOutcome.id]}
              recentSeeds={(seedsByOutcome[activeOutcome.id] ?? []).slice(0, 30)}
              n={n}
              setN={setN}
              running={running.has(activeOutcome.id)}
              lastResult={lastResult[activeOutcome.id]}
              onRun={() => run(activeOutcome.id)}
            />
          )}
        </>
      )}

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
    </div>
  )
}

function BurstSurface({ outcome, readiness, recentSeeds, n, setN, running, lastResult, onRun }: {
  outcome: OutcomeRowFull
  readiness: Readiness | undefined
  recentSeeds: SongSeedRow[]
  n: number
  setN: (n: number) => void
  running: boolean
  lastResult: SeedBuilderResult | undefined
  onRun: () => void
}) {
  const ready = readiness?.ready ?? false
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Run controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: S.label, color: T.textDim, fontFamily: T.sans,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>batch size</span>
          <input
            type="number" min={1} max={20} value={n}
            onChange={(e) => setN(Math.max(1, Math.min(20, Number(e.target.value) || DEFAULT_N)))}
            style={{
              width: 60, background: T.bg, color: T.text,
              border: `1px solid ${T.border}`, padding: '6px 8px',
              fontFamily: T.mono, fontSize: 14,
            }}
          />
          <Button onClick={onRun} disabled={running || !ready}>
            {running ? 'seeding…' : `seed ${n} for ${outcome.displayTitle ?? outcome.title}`}
          </Button>
          {!ready && readiness && (
            <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>
              {readiness.approvedHooks === 0
                ? 'approve at least one hook for this outcome before seeding'
                : 'decompose at least one reference track for this ICP before seeding'}
            </span>
          )}
        </div>
        {running && (
          <LlmProgress
            etaSeconds={Math.max(15, n * SECONDS_PER_SEED)}
            label={`assembling ${n} seed${n === 1 ? '' : 's'}`}
          />
        )}
        {lastResult && !running && (
          <div style={{
            fontFamily: T.mono, fontSize: 12, color: T.textDim,
            background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
            borderRadius: 3, padding: '6px 10px',
          }}>
            last batch: {lastResult.producedN} / {lastResult.requestedN} produced · {lastResult.reason}
            {lastResult.errors.length > 0 && (
              <span style={{ color: T.danger }}> · {lastResult.errors.length} error{lastResult.errors.length === 1 ? '' : 's'}</span>
            )}
          </div>
        )}
      </div>

      {/* Recent seeds for this outcome */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Heading>Recent Song Prompts ({recentSeeds.length})</Heading>
        {recentSeeds.length === 0 ? (
          <Empty>no seeds yet for this outcome</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentSeeds.map((s) => <SeedRow key={s.id} seed={s} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function SeedRow({ seed }: { seed: SongSeedRow }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
      borderRadius: 4, padding: '8px 12px', display: 'flex',
      alignItems: 'center', gap: 10,
    }}>
      <StatusPill status={seed.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: T.sans, fontSize: 13, color: T.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {seed.title || seed.hook.text}
        </div>
        {seed.referenceTrack && (
          <div style={{
            fontFamily: T.mono, fontSize: 11, color: T.textDim,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginTop: 2,
          }}>
            ref: {seed.referenceTrack.artist} — {seed.referenceTrack.title}
          </div>
        )}
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim }}>
        {new Date(seed.createdAt).toLocaleTimeString()}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: SongSeedRow['status'] }) {
  const palette: Record<SongSeedRow['status'], { bg: string; fg: string }> = {
    assembling: { bg: 'rgba(136,192,201,0.18)', fg: T.accent },
    queued: { bg: T.surfaceRaised, fg: T.text },
    accepted: { bg: 'rgba(80,180,120,0.18)', fg: '#7fdba0' },
    failed: { bg: 'rgba(220,80,80,0.18)', fg: T.danger },
  }
  const p = palette[status]
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 11, textTransform: 'uppercase',
      letterSpacing: '0.04em', color: p.fg, background: p.bg,
      border: `1px solid ${p.fg}`, borderRadius: 3,
      padding: '2px 6px', flexShrink: 0,
    }}>{status}</span>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: T.sans, fontSize: 13, color: T.textDim, fontWeight: 500,
    }}>{children}</div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px dashed ${T.borderSubtle}`,
      borderRadius: 4, padding: '12px 14px', color: T.textDim,
      fontFamily: T.sans, fontSize: 13,
    }}>{children}</div>
  )
}
