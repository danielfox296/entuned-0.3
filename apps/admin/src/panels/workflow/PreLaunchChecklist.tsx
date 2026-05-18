import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type {
  StoreDetail, HookRowFull, PoolDepthResponse, ScheduleSlot, LiveStoreView,
} from '../../api.js'
import { T } from '@entuned/tokens'
import { S } from '../../ui/index.js'
import type { WorkflowContext } from './WorkflowRouter.js'

// Launch Checklist — purpose:
//   Tell you whether this location can ship, what blocks it, and the single
//   next step to take. Treats "won't launch" and "could be better" as different
//   problems, not a single red list.
//
// Color discipline:
//   red    = hard launch blocker (cannot go live)
//   amber  = works but suboptimal (can launch, would be better polished)
//   green  = done
//
// Sections are grouped by *function*, not by data shape:
//   1. Hero — one calm sentence + the next action
//   2. Location config (collapses when green)
//   3. ICP readiness (single table — replaces the old split hooks/refs gates)
//   4. Pipeline readiness (pool depth + schedule — only when actionable)
//   5. Operational (player paired — separate, not a launch gate)

const FRESH_PLAYER_HOURS = 24

type IcpReadiness = {
  id: string
  name: string
  approvedHooks: number
  decomposedRefs: number
  hooksOk: boolean
  refsOk: boolean
  fullyReady: boolean
}

function navigateTo(group: string, sub: string, pendingOutcomeId?: string) {
  if (pendingOutcomeId && typeof window !== 'undefined') {
    window.sessionStorage.setItem('workflow.pendingOutcomeId', pendingOutcomeId)
  }
  const h = sub ? `${encodeURIComponent(group)}/${encodeURIComponent(sub)}` : encodeURIComponent(group)
  window.location.hash = h
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

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

  const icps: IcpReadiness[] = useMemo(() => {
    if (!detail) return []
    return detail.icps.map((i) => {
      const approvedHooks = (hooksByIcp[i.id] ?? []).filter((h) => h.status === 'approved').length
      const decomposedRefs = i.referenceTracks.filter((t) => t.status === 'approved' && t.styleAnalysis).length
      const hooksOk = approvedHooks > 0
      const refsOk = decomposedRefs > 0
      return { id: i.id, name: i.name, approvedHooks, decomposedRefs, hooksOk, refsOk, fullyReady: hooksOk && refsOk }
    })
  }, [detail, hooksByIcp])

  if (!ctx.storeId) {
    return <div style={infoBox}>select a location above to begin</div>
  }
  if (loading && !detail) {
    return <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 14 }}>checking gates…</div>
  }
  if (!detail) {
    return err
      ? <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>
      : <div style={infoBox}>no location data</div>
  }

  const timezoneOk = !!detail.store.timezone
  const defaultOutcomeOk = !!detail.store.defaultOutcomeId
  const configOk = timezoneOk && defaultOutcomeOk

  const readyIcps = icps.filter((i) => i.fullyReady)
  const launchable = configOk && readyIcps.length > 0

  const slotCount = schedule?.length ?? 0
  const scheduleOk = slotCount > 0

  // Pool depth — only render when default outcome is set; otherwise it's
  // derivative of the config issue and shouldn't double-report.
  let poolIssue: string | null = null
  if (defaultOutcomeOk && pool) {
    const storeIcpIds = new Set(icps.map((i) => i.id))
    const relevant = pool.icps.filter((i) => storeIcpIds.has(i.id))
    const critical = relevant.filter((i) => {
      const cell = i.outcomes.find((o) => o.outcome.id === detail.store.defaultOutcomeId)
      return cell && cell.status === 'critical'
    })
    if (critical.length > 0) {
      poolIssue = `${critical.length} ICP${critical.length === 1 ? '' : 's'} below critical pool for the default outcome`
    }
  }

  const playerLatest = live?.recentEvents
    .map((e) => Date.parse(e.occurredAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0]
  const playerOk = !!playerLatest && (Date.now() - playerLatest) < FRESH_PLAYER_HOURS * 3600 * 1000

  // Compute the single next-action — what to surface in the hero.
  const next = pickNextAction({
    timezoneOk, defaultOutcomeOk, icps, scheduleOk, playerOk, playerLatest, launchable,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Hero */}
      <Hero launchable={launchable} next={next} icps={icps} />

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}

      {/* Location config — only renders detail when something's off */}
      {configOk ? (
        <DoneLine label="Location config" detail={`timezone ${detail.store.timezone} · default outcome set`} />
      ) : (
        <Card>
          <CardHead label="Location config" tone="block" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!timezoneOk && (
              <ConfigItem
                tone="block"
                label="No timezone set"
                action={{ label: 'open Location settings', onClick: () => navigateTo('brand', 'Location') }}
              />
            )}
            {!defaultOutcomeOk && (
              <ConfigItem
                tone="block"
                label="No default outcome set"
                action={{ label: 'set default outcome', onClick: () => navigateTo('brand', 'Location') }}
              />
            )}
            {timezoneOk && <ConfigItem tone="ok" label={`Timezone: ${detail.store.timezone}`} />}
            {defaultOutcomeOk && <ConfigItem tone="ok" label="Default outcome set" />}
          </div>
        </Card>
      )}

      {/* ICP readiness — one table, both axes */}
      {icps.length === 0 ? (
        <Card>
          <CardHead label="ICPs" tone="block" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontFamily: T.sans, color: T.textMuted }}>
              No ICPs at this location.
            </span>
            <ActionLink onClick={() => navigateTo('brand', 'ICP Editor')}>open ICP Editor →</ActionLink>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHead
            label="ICP readiness"
            tone={readyIcps.length === icps.length ? 'ok' : readyIcps.length === 0 ? 'block' : 'soft'}
            right={
              <span style={{ fontSize: 12, fontFamily: T.mono, color: T.textMuted }}>
                {readyIcps.length} of {icps.length} fully ready
              </span>
            }
          />
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ICP</th>
                <th style={thStyle}>Hooks</th>
                <th style={thStyle}>Ref tracks</th>
                <th style={{ ...thStyle, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {icps.map((i) => (
                <IcpRow key={i.id} icp={i} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Pipeline readiness — only when there's something to say */}
      {(poolIssue || !scheduleOk) && (
        <Card>
          <CardHead label="Pipeline" tone="soft" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {poolIssue && (
              <ConfigItem
                tone="soft"
                label={poolIssue}
                action={{ label: 'open Pipeline', onClick: () => navigateTo('workflows', 'Pipeline') }}
              />
            )}
            {!scheduleOk && (
              <ConfigItem
                tone="soft"
                label="No schedule slots — will fall back to the default outcome only"
                action={{ label: 'open Schedule', onClick: () => navigateTo('schedule', 'Outcome Schedule') }}
              />
            )}
          </div>
        </Card>
      )}

      {/* Operational — separated as post-launch monitoring, not a launch gate */}
      <div style={{ marginTop: 4, paddingTop: 12, borderTop: `1px solid ${T.borderSubtle}` }}>
        <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
          Operational (post-launch)
        </div>
        <div style={{ fontSize: 13, fontFamily: T.sans, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Dot tone={playerOk ? 'ok' : !playerLatest ? 'soft' : 'block'} />
          <span style={{ flex: 1 }}>
            {playerOk ? `Player last pinged ${humanizeAge(playerLatest!)}` : playerLatest ? `Player last pinged ${humanizeAge(playerLatest)} — over ${FRESH_PLAYER_HOURS}h ago` : 'Player has never pinged'}
          </span>
          <ActionLink onClick={() => navigateTo('brand', 'Event Stream')}>check event stream →</ActionLink>
        </div>
      </div>
    </div>
  )
}

function pickNextAction(args: {
  timezoneOk: boolean
  defaultOutcomeOk: boolean
  icps: IcpReadiness[]
  scheduleOk: boolean
  playerOk: boolean
  playerLatest: number | undefined
  launchable: boolean
}): { headline: string; subline?: string; action?: { label: string; onClick: () => void } } {
  const { timezoneOk, defaultOutcomeOk, icps, scheduleOk, playerOk, launchable } = args
  if (!timezoneOk) {
    return {
      headline: 'Set this location\'s timezone to launch.',
      action: { label: 'Open Location settings', onClick: () => navigateTo('brand', 'Location') },
    }
  }
  if (!defaultOutcomeOk) {
    return {
      headline: 'Set a default outcome to launch this location.',
      subline: 'The default is what plays when no schedule slot applies. You can change it any time.',
      action: { label: 'Open Location settings', onClick: () => navigateTo('brand', 'Location') },
    }
  }
  if (icps.length === 0) {
    return {
      headline: 'Add at least one ICP to launch.',
      action: { label: 'Open ICP Editor', onClick: () => navigateTo('brand', 'ICP Editor') },
    }
  }
  const ready = icps.filter((i) => i.fullyReady)
  if (ready.length === 0) {
    // Pick the closest-to-ready ICP — one missing only hooks, or only refs.
    const halfReady = icps.find((i) => !i.fullyReady && (i.hooksOk || i.refsOk))
    if (halfReady) {
      const need = !halfReady.hooksOk ? 'hooks' : 'reference tracks'
      const tab = need === 'hooks' ? 'Hook Writing' : 'Reference Tracks'
      return {
        headline: `No ICPs ready to play yet. ${halfReady.name} needs ${need}.`,
        action: { label: `Open ${tab}`, onClick: () => navigateTo('workflows', tab, halfReady.id) },
      }
    }
    return {
      headline: 'No ICPs ready to play yet. Start with hooks and reference tracks for any ICP.',
      action: { label: 'Open Hook Writing', onClick: () => navigateTo('workflows', 'Hook Writing') },
    }
  }
  if (launchable && ready.length < icps.length) {
    const blocked = icps.find((i) => !i.fullyReady)!
    const need = !blocked.hooksOk ? 'hooks' : 'reference tracks'
    const tab = need === 'hooks' ? 'Hook Writing' : 'Reference Tracks'
    return {
      headline: `${ready.length} of ${icps.length} ICPs fully ready. Add ${need} for ${blocked.name} to use the full set.`,
      action: { label: `Open ${tab}`, onClick: () => navigateTo('workflows', tab, blocked.id) },
    }
  }
  if (!scheduleOk) {
    return {
      headline: 'Ready to launch. Add an outcome schedule to use more than the default outcome.',
      subline: 'Schedules are optional — without one, the default outcome plays all day.',
      action: { label: 'Open Schedule', onClick: () => navigateTo('schedule', 'Outcome Schedule') },
    }
  }
  if (!playerOk) {
    return {
      headline: 'Ready to launch. Pair a player to start playing music.',
      action: { label: 'Check event stream', onClick: () => navigateTo('brand', 'Event Stream') },
    }
  }
  return { headline: 'Ready to launch. Everything is in place.' }
}

function Hero({ launchable, next, icps }: {
  launchable: boolean
  next: ReturnType<typeof pickNextAction>
  icps: IcpReadiness[]
}) {
  const allReady = icps.length > 0 && icps.every((i) => i.fullyReady)
  const tone: 'block' | 'soft' | 'ok' = !launchable ? 'block' : allReady ? 'ok' : 'soft'
  const badgeLabel = !launchable ? 'launch blocked' : allReady ? 'ready to ship' : 'launchable'
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderLeft: `4px solid ${toneColor(tone)}`,
      borderRadius: 4, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontFamily: T.mono, fontWeight: 600,
          color: toneColor(tone),
          background: toneTint(tone),
          border: `1px solid ${toneColor(tone)}33`,
          borderRadius: 2, padding: '2px 7px',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>{badgeLabel}</span>
        <span style={{ fontSize: 16, fontFamily: T.sans, color: T.text, fontWeight: 500 }}>
          {next.headline}
        </span>
      </div>
      {next.subline && (
        <div style={{ fontSize: 13, fontFamily: T.sans, color: T.textMuted, paddingLeft: 0 }}>
          {next.subline}
        </div>
      )}
      {next.action && (
        <div>
          <button onClick={next.action.onClick} style={heroBtnStyle(tone)}>
            {next.action.label} →
          </button>
        </div>
      )}
    </div>
  )
}

function IcpRow({ icp }: { icp: IcpReadiness }) {
  const needsHooks = !icp.hooksOk
  const needsRefs = !icp.refsOk
  let action: { label: string; onClick: () => void } | null = null
  if (needsHooks && needsRefs) action = { label: 'start →', onClick: () => navigateTo('workflows', 'Hook Writing', icp.id) }
  else if (needsHooks) action = { label: 'write hooks →', onClick: () => navigateTo('workflows', 'Hook Writing', icp.id) }
  else if (needsRefs) action = { label: 'add refs →', onClick: () => navigateTo('workflows', 'Reference Tracks', icp.id) }

  return (
    <tr style={{ borderBottom: `1px solid ${T.borderSubtle}` }}>
      <td style={tdStyle}>
        <span style={{ fontSize: 14, fontFamily: T.sans, color: T.text }}>{icp.name}</span>
      </td>
      <td style={tdStyle}>
        <CountChip ok={icp.hooksOk} value={icp.approvedHooks} />
      </td>
      <td style={tdStyle}>
        <CountChip ok={icp.refsOk} value={icp.decomposedRefs} />
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        {action ? <ActionLink onClick={action.onClick}>{action.label}</ActionLink> : (
          <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textDim }}>ready</span>
        )}
      </td>
    </tr>
  )
}

function CountChip({ ok, value }: { ok: boolean; value: number }) {
  const color = ok ? '#7fdba0' : '#f59e0b'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: T.mono, fontSize: 12,
      color: ok ? T.textMuted : color,
    }}>
      <Dot tone={ok ? 'ok' : 'soft'} />
      {value}
    </span>
  )
}

function Dot({ tone }: { tone: 'ok' | 'soft' | 'block' }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: 4,
      background: toneColor(tone), display: 'inline-block',
    }} />
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>{children}</div>
  )
}

function CardHead({ label, tone, right }: { label: string; tone: 'ok' | 'soft' | 'block'; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Dot tone={tone} />
      <span style={{ fontSize: 14, fontFamily: T.sans, color: T.text, fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  )
}

function ConfigItem({ tone, label, action }: { tone: 'ok' | 'soft' | 'block'; label: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Dot tone={tone} />
      <span style={{
        fontSize: 13, fontFamily: T.sans,
        color: tone === 'ok' ? T.textMuted : T.text,
      }}>{label}</span>
      <span style={{ flex: 1 }} />
      {action && <ActionLink onClick={action.onClick}>{action.label} →</ActionLink>}
    </div>
  )
}

function DoneLine({ label, detail }: { label: string; detail: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px', borderRadius: 3,
      background: 'transparent',
    }}>
      <Dot tone="ok" />
      <span style={{ fontSize: 13, fontFamily: T.sans, color: T.textMuted }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: T.mono, color: T.textDim }}>· {detail}</span>
    </div>
  )
}

function ActionLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={actionLinkStyle}>{children}</button>
  )
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

function toneColor(tone: 'ok' | 'soft' | 'block'): string {
  return tone === 'ok' ? '#7fdba0' : tone === 'soft' ? '#f59e0b' : T.danger
}
function toneTint(tone: 'ok' | 'soft' | 'block'): string {
  return tone === 'ok'
    ? 'rgba(127,219,160,0.10)'
    : tone === 'soft'
      ? 'rgba(245,158,11,0.10)'
      : 'rgba(220,80,80,0.10)'
}

const infoBox: CSSProperties = {
  background: T.surfaceRaised, border: `1px solid ${T.border}`,
  borderRadius: 4, padding: '14px 18px', color: T.textMuted,
  fontFamily: T.sans, fontSize: 14,
}

const thStyle: CSSProperties = {
  fontSize: 10, fontFamily: T.mono, color: T.textDim,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  textAlign: 'left', padding: '4px 6px',
  borderBottom: `1px solid ${T.borderSubtle}`,
  fontWeight: 500,
}
const tdStyle: CSSProperties = {
  padding: '8px 6px', verticalAlign: 'middle',
}

const actionLinkStyle: CSSProperties = {
  background: 'transparent', border: 'none',
  color: T.accent, fontFamily: T.mono, fontSize: 12,
  cursor: 'pointer', padding: '2px 4px',
  textDecoration: 'underline', textUnderlineOffset: 3,
}

function heroBtnStyle(tone: 'ok' | 'soft' | 'block'): CSSProperties {
  return {
    background: toneColor(tone), color: T.bg,
    border: 'none', borderRadius: 3, padding: '8px 14px',
    fontFamily: T.sans, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }
}

// Suppress unused-import warning for S now that we don't reference it.
void S
