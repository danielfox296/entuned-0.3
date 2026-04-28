import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type {
  StoreDetail, HookRowFull, PoolDepthResponse, ScheduleSlot, LiveStoreView,
} from '../../api.js'
import { T } from '../../tokens.js'
import { S } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

type Status = 'pass' | 'fail' | 'pending' | 'warn'

type Gate = {
  title: string
  status: Status
  detail: string
  /** Optional list of sub-items (e.g. per-ICP breakdown). */
  items?: { ok: boolean; label: string }[]
}

const FRESH_PLAYER_HOURS = 24

export function PreLaunchChecklist({ ctx }: { ctx: WorkflowContext }) {
  const [detail, setDetail] = useState<StoreDetail | null>(null)
  const [hooksByIcp, setHooksByIcp] = useState<Record<string, HookRowFull[]>>({})
  const [pool, setPool] = useState<PoolDepthResponse | null>(null)
  const [schedule, setSchedule] = useState<ScheduleSlot[] | null>(null)
  const [live, setLive] = useState<LiveStoreView | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!ctx.storeId) {
      setDetail(null); setHooksByIcp({}); setPool(null); setSchedule(null); setLive(null)
      return
    }
    const token = getToken(); if (!token) return
    const storeId = ctx.storeId
    let cancelled = false
    setLoading(true); setErr(null)
    ;(async () => {
      try {
        const [storeRes, poolRes, schedRes, liveRes] = await Promise.all([
          api.storeDetail(storeId, token),
          api.poolDepth(token),
          api.schedule(storeId, token),
          api.liveStore(storeId, token).catch(() => null),
        ])
        if (cancelled) return
        setDetail(storeRes); setPool(poolRes); setSchedule(schedRes); setLive(liveRes)

        const icpHooks: Record<string, HookRowFull[]> = {}
        await Promise.all(storeRes.icps.map(async (i) => {
          try { icpHooks[i.id] = await api.icpHooks(i.id, token) } catch {}
        }))
        if (!cancelled) setHooksByIcp(icpHooks)
      } catch (e: any) {
        if (!cancelled) setErr(e.message ?? 'failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [ctx.storeId])

  const gates: Gate[] = useMemo(() => {
    if (!ctx.storeId || !detail) return []
    return computeGates({ detail, hooksByIcp, pool, schedule, live })
  }, [ctx.storeId, detail, hooksByIcp, pool, schedule, live])

  const passCount = gates.filter((g) => g.status === 'pass').length
  const totalCount = gates.length
  const allPass = totalCount > 0 && passCount === totalCount

  if (!ctx.storeId) {
    return (
      <div style={{
        background: T.surfaceRaised, border: `1px solid ${T.border}`,
        borderRadius: 4, padding: '14px 18px', color: T.textMuted,
        fontFamily: T.sans, fontSize: 14,
      }}>
        select a location above to begin
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SummaryBanner allPass={allPass} passCount={passCount} totalCount={totalCount} loading={loading} />
      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {gates.map((g, i) => <GateRow key={i} gate={g} />)}
      </div>
    </div>
  )
}

function computeGates(args: {
  detail: StoreDetail
  hooksByIcp: Record<string, HookRowFull[]>
  pool: PoolDepthResponse | null
  schedule: ScheduleSlot[] | null
  live: LiveStoreView | null
}): Gate[] {
  const { detail, hooksByIcp, pool, schedule, live } = args
  const out: Gate[] = []

  // 1. Store config
  const tzOk = !!detail.store.timezone
  const defOk = !!detail.store.defaultOutcomeId
  out.push({
    title: 'Location config',
    status: tzOk && defOk ? 'pass' : 'fail',
    detail: tzOk && defOk
      ? `tz ${detail.store.timezone} · default outcome set`
      : !tzOk ? 'no timezone set'
      : 'no default outcome set',
    items: [
      { ok: tzOk, label: tzOk ? `timezone: ${detail.store.timezone}` : 'timezone missing' },
      { ok: defOk, label: defOk ? 'default outcome set' : 'default outcome missing' },
    ],
  })

  // 2. ICPs exist
  const icpCount = detail.icps.length
  out.push({
    title: 'ICPs',
    status: icpCount > 0 ? 'pass' : 'fail',
    detail: `${icpCount} ICP${icpCount === 1 ? '' : 's'} on this location`,
  })

  // 3. Approved hooks per ICP
  const hookItems = detail.icps.map((i) => {
    const approved = (hooksByIcp[i.id] ?? []).filter((h) => h.status === 'approved').length
    return { ok: approved > 0, label: `${i.name}: ${approved} approved` }
  })
  const allHaveHooks = hookItems.length > 0 && hookItems.every((x) => x.ok)
  out.push({
    title: 'Approved hooks',
    status: hookItems.length === 0 ? 'fail' : allHaveHooks ? 'pass' : 'fail',
    detail: hookItems.length === 0
      ? 'no ICPs to evaluate'
      : allHaveHooks
        ? `every ICP has approved hooks`
        : `${hookItems.filter((x) => !x.ok).length} ICP${hookItems.filter((x) => !x.ok).length === 1 ? '' : 's'} missing approved hooks`,
    items: hookItems,
  })

  // 4. Reference tracks analyzed per ICP
  const trackItems = detail.icps.map((i) => {
    const analyzed = i.referenceTracks.filter(
      (t) => t.status === 'approved' && t.styleAnalysis,
    ).length
    return { ok: analyzed > 0, label: `${i.name}: ${analyzed} decomposed` }
  })
  const allHaveTracks = trackItems.length > 0 && trackItems.every((x) => x.ok)
  out.push({
    title: 'Reference tracks decomposed',
    status: trackItems.length === 0 ? 'fail' : allHaveTracks ? 'pass' : 'fail',
    detail: trackItems.length === 0
      ? 'no ICPs to evaluate'
      : allHaveTracks
        ? `every ICP has at least one decomposed reference track`
        : `${trackItems.filter((x) => !x.ok).length} ICP${trackItems.filter((x) => !x.ok).length === 1 ? '' : 's'} missing decomposed reference tracks`,
    items: trackItems,
  })

  // 5. Pool depth — at least the default outcome must be non-critical for every ICP at this store.
  const defaultOutcomeId = detail.store.defaultOutcomeId
  if (!defaultOutcomeId) {
    out.push({
      title: 'Pool depth (default outcome)',
      status: 'fail',
      detail: 'cannot evaluate — no default outcome',
    })
  } else if (!pool) {
    out.push({
      title: 'Pool depth (default outcome)',
      status: 'pending',
      detail: 'loading pool data…',
    })
  } else {
    const storeIcpIds = new Set(detail.icps.map((i) => i.id))
    const relevantIcps = pool.icps.filter((i) => storeIcpIds.has(i.id))
    const items = relevantIcps.map((i) => {
      const cell = i.outcomes.find((o) => o.outcome.id === defaultOutcomeId)
      const ok = !!cell && cell.status !== 'critical'
      const label = cell
        ? `${i.name}: ${cell.count} song${cell.count === 1 ? '' : 's'} (${cell.status})`
        : `${i.name}: no pool data for default outcome`
      return { ok, label }
    })
    const allOk = items.length > 0 && items.every((x) => x.ok)
    out.push({
      title: 'Pool depth (default outcome)',
      status: items.length === 0 ? 'fail' : allOk ? 'pass' : 'fail',
      detail: items.length === 0
        ? 'no pool data for this location'
        : allOk
          ? 'no critical pools'
          : `${items.filter((x) => !x.ok).length} ICP${items.filter((x) => !x.ok).length === 1 ? '' : 's'} below critical threshold`,
      items,
    })
  }

  // 6. Schedule
  const slotCount = schedule?.length ?? 0
  out.push({
    title: 'Outcome schedule',
    status: slotCount > 0 ? 'pass' : 'fail',
    detail: slotCount > 0
      ? `${slotCount} slot${slotCount === 1 ? '' : 's'} configured`
      : 'no schedule slots — location will fall back to the default outcome only',
  })

  // 7. Player presence — is a player paired and pinging? Use most recent
  // playback event as proxy. If no live response, mark as warn (we couldn't
  // reach the live endpoint — operator should manually confirm).
  if (!live) {
    out.push({
      title: 'Player paired',
      status: 'warn',
      detail: 'no live response (endpoint unreachable or location has never had a player)',
    })
  } else {
    const latest = live.recentEvents
      .map((e) => Date.parse(e.occurredAt))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => b - a)[0]
    const ok = !!latest && (Date.now() - latest) < FRESH_PLAYER_HOURS * 3600 * 1000
    out.push({
      title: 'Player paired',
      status: ok ? 'pass' : 'fail',
      detail: latest
        ? `last ping ${humanizeAge(latest)}`
        : 'no playback events yet — player has never pinged',
    })
  }

  return out
}

function humanizeAge(t: number): string {
  const ms = Date.now() - t
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

function SummaryBanner({ allPass, passCount, totalCount, loading }: {
  allPass: boolean
  passCount: number
  totalCount: number
  loading: boolean
}) {
  if (loading && totalCount === 0) {
    return (
      <Banner tone="neutral">
        <span style={{ fontFamily: T.mono, fontSize: 12 }}>checking gates…</span>
      </Banner>
    )
  }
  if (allPass) {
    return (
      <Banner tone="pass">
        <strong style={{ fontFamily: T.heading, fontSize: 16 }}>Ready to ship.</strong>
        <span style={{ marginLeft: 8, fontFamily: T.mono, fontSize: 12 }}>
          {passCount} of {totalCount} gates green.
        </span>
      </Banner>
    )
  }
  const remaining = totalCount - passCount
  return (
    <Banner tone="fail">
      <strong style={{ fontFamily: T.heading, fontSize: 16 }}>{remaining} gate{remaining === 1 ? '' : 's'} remaining.</strong>
      <span style={{ marginLeft: 8, fontFamily: T.mono, fontSize: 12 }}>
        {passCount} of {totalCount} green.
      </span>
    </Banner>
  )
}

function Banner({ tone, children }: { tone: 'pass' | 'fail' | 'neutral'; children: React.ReactNode }) {
  const styles: Record<string, React.CSSProperties> = {
    pass: { background: 'rgba(80,180,120,0.14)', border: '1px solid rgba(127,219,160,0.6)', color: T.text },
    fail: { background: 'rgba(220,80,80,0.14)', border: `1px solid ${T.danger}`, color: T.text },
    neutral: { background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`, color: T.textMuted },
  }
  return (
    <div style={{
      ...styles[tone],
      padding: '10px 14px', borderRadius: 4,
      display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 4,
      fontFamily: T.sans, fontSize: 14,
    }}>{children}</div>
  )
}

function GateRow({ gate }: { gate: Gate }) {
  const palette: Record<Status, { glyph: string; color: string }> = {
    pass: { glyph: '✓', color: '#7fdba0' },
    fail: { glyph: '✕', color: T.danger },
    pending: { glyph: '…', color: T.textDim },
    warn: { glyph: '!', color: '#e6c46c' },
  }
  const p = palette[gate.status]
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.borderSubtle}`,
      borderRadius: 4, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 11, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: `1px solid ${p.color}`,
          color: p.color, fontFamily: T.mono, fontSize: 13, fontWeight: 700,
        }}>{p.glyph}</span>
        <div style={{ fontFamily: T.sans, fontSize: 14, fontWeight: 500, color: T.text }}>
          {gate.title}
        </div>
        <div style={{ fontFamily: T.sans, fontSize: S.small, color: T.textMuted }}>
          {gate.detail}
        </div>
      </div>
      {gate.items && gate.items.length > 0 && (
        <ul style={{
          margin: 0, padding: 0, paddingLeft: 32,
          listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {gate.items.map((it, i) => (
            <li key={i} style={{
              fontFamily: T.mono, fontSize: 12,
              color: it.ok ? T.textDim : T.danger,
              display: 'flex', alignItems: 'baseline', gap: 6,
            }}>
              <span style={{ color: it.ok ? '#7fdba0' : T.danger }}>{it.ok ? '·' : '✕'}</span>
              <span>{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
