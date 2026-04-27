import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ScheduleDryRun, DryRunPeriod, StoreSummary } from '../../api.js'
import { T } from '../../tokens.js'
import { PanelHeader, StorePicker, S, useStoreSelection } from '../../ui/index.js'

const DAY_MINUTES = 24 * 60

export function DryRun() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useStoreSelection()
  const [data, setData] = useState<ScheduleDryRun | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!storeId) { setData(null); return }
    const token = getToken(); if (!token) return
    setLoading(true); setErr(null); setData(null)
    api.scheduleDryRun(storeId, token)
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [storeId])

  const issues = useMemo(() => {
    if (!data) return [] as string[]
    const out: string[] = []
    if (data.totals.gapMin > 0) {
      out.push(`${fmtDur(data.totals.gapMin)} of weekly time has no outcome (no schedule row, no default).`)
    }
    if (!data.defaultOutcome) {
      out.push('No default outcome set on this store — gaps in the schedule resolve to nothing.')
    } else if (data.defaultOutcome.superseded) {
      out.push(`Default outcome "${data.defaultOutcome.title}" is superseded — replace it before any gap is hit.`)
    }
    const supersededOutcomes = data.byOutcome.filter((o) => o.outcomeSuperseded)
    if (supersededOutcomes.length > 0) {
      out.push(`Schedule references superseded outcomes: ${supersededOutcomes.map((o) => o.outcomeTitle).join(', ')}.`)
    }
    const critical = data.byOutcome.filter((o) => o.poolStatus === 'critical' && o.totalMin > 0)
    if (critical.length > 0) {
      out.push(`${critical.length} outcome(s) are scheduled but their pool is CRITICAL (< ${data.thresholds.critical} active LineageRows): ${critical.map((o) => o.outcomeTitle).join(', ')}.`)
    }
    const thin = data.byOutcome.filter((o) => o.poolStatus === 'thin' && o.totalMin > 0)
    if (thin.length > 0) {
      out.push(`${thin.length} outcome(s) are scheduled with thin pools (< ${data.thresholds.thin}): ${thin.map((o) => o.outcomeTitle).join(', ')}.`)
    }
    const overlaps = data.days.flatMap((d) => d.periods.filter((p) => p.overlap).map((p) => `${d.label} ${p.startHHMM}`))
    if (overlaps.length > 0) {
      out.push(`Overlapping schedule rows at: ${overlaps.join(', ')} (later row's start was clipped).`)
    }
    return out
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <PanelHeader
        title="Schedule Dry Run"
        subtitle="Project the weekly schedule for one store. Gaps fall through to the store's default outcome (or surface as untouched gaps). Pool depth is joined per-(ICP × outcome) so you can see which pools your schedule actually depends on."
      />

      <StorePicker stores={stores} storeId={storeId} onPick={setStoreId} />

      {err && <div style={{ fontSize: 14, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {loading && <div style={{ fontSize: 14, color: T.textMuted, fontFamily: T.mono }}>simulating…</div>}

      {data && (
        <>
          <SummaryRow data={data} />
          {issues.length > 0 ? <Issues items={issues} /> : (
            <div style={{
              fontSize: 14, fontFamily: T.mono, color: T.success,
              border: `1px solid ${T.success}`, borderRadius: 4,
              padding: '8px 12px', background: T.surface,
            }}>
              ✓ no issues — schedule covers the full week and every referenced outcome has a healthy pool
            </div>
          )}
          <ByOutcomeTable data={data} />
          <Timeline data={data} />
        </>
      )}
    </div>
  )
}

function SummaryRow({ data }: { data: ScheduleDryRun }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Chip label="scheduled" value={fmtDur(data.totals.scheduledMin)} pct={pct(data.totals.scheduledMin, data.totals.totalMin)} color={T.accent} />
      <Chip label="default fill" value={fmtDur(data.totals.defaultMin)} pct={pct(data.totals.defaultMin, data.totals.totalMin)} color={T.textMuted} />
      <Chip label="gap" value={fmtDur(data.totals.gapMin)} pct={pct(data.totals.gapMin, data.totals.totalMin)} color={data.totals.gapMin > 0 ? T.danger : T.textDim} />
      <Chip label="default outcome" value={data.defaultOutcome?.title ?? '—'} color={data.defaultOutcome ? T.text : T.danger} />
      <Chip
        label={`ICPs (${data.icps.length})`}
        value={data.icps.length === 0 ? '—' : data.icps.map((i) => i.name).join(', ')}
        color={data.icps.length > 0 ? T.text : T.textDim}
      />
      <Chip label="timezone" value={data.store.timezone} color={T.textMuted} />
    </div>
  )
}

function Chip({ label, value, pct, color }: { label: string; value: string; pct?: string; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      padding: '8px 14px', borderRadius: 4,
      border: `1px solid ${T.border}`, background: T.surface,
      minWidth: 120,
    }}>
      <div style={{ fontFamily: T.mono, fontSize: 16, color, fontWeight: 600, lineHeight: 1.2 }}>
        {value}{pct && <span style={{ color: T.textDim, fontSize: 13, marginLeft: 6 }}>{pct}</span>}
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
    </div>
  )
}

function Issues({ items }: { items: string[] }) {
  return (
    <div style={{
      border: `1px solid ${T.warn}`, borderRadius: 4,
      padding: '10px 14px', background: T.surface,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontFamily: T.mono, fontSize: 13, color: T.warn, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {items.length} issue{items.length === 1 ? '' : 's'}
      </div>
      {items.map((i, idx) => (
        <div key={idx} style={{ fontFamily: T.sans, fontSize: 14, color: T.text, lineHeight: 1.5 }}>· {i}</div>
      ))}
    </div>
  )
}

const TBL_COLS = '1.6fr 90px 90px 90px 80px 90px'

function ByOutcomeTable({ data }: { data: ScheduleDryRun }) {
  if (data.byOutcome.length === 0) return null
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: TBL_COLS, gap: 10,
        padding: '8px 12px', background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        fontFamily: T.mono, fontSize: 13, color: T.textDim, textTransform: 'uppercase',
      }}>
        <span>outcome</span>
        <span style={{ textAlign: 'right' }}>scheduled</span>
        <span style={{ textAlign: 'right' }}>default fill</span>
        <span style={{ textAlign: 'right' }}>total</span>
        <span style={{ textAlign: 'right' }}>pool</span>
        <span style={{ textAlign: 'right' }}>status</span>
      </div>
      {data.byOutcome.map((o) => {
        const color = o.poolStatus === 'critical' ? T.danger : o.poolStatus === 'thin' ? T.warn : T.success
        return (
          <div key={o.outcomeId} style={{
            display: 'grid', gridTemplateColumns: TBL_COLS, gap: 10,
            padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
            fontFamily: T.mono, fontSize: 14, alignItems: 'center',
          }}>
            <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500 }}>
              {o.outcomeTitle} <span style={{ color: T.accentMuted }}>v{o.outcomeVersion}</span>
              {o.outcomeSuperseded && <span style={{ color: T.danger, fontFamily: T.mono, fontSize: 12, marginLeft: 6 }}>SUPERSEDED</span>}
            </span>
            <span style={{ textAlign: 'right', color: T.text }}>{fmtDur(o.scheduledMin)}</span>
            <span style={{ textAlign: 'right', color: T.textMuted }}>{fmtDur(o.defaultMin)}</span>
            <span style={{ textAlign: 'right', color: T.text, fontWeight: 600 }}>{fmtDur(o.totalMin)}</span>
            <span style={{ textAlign: 'right', color, fontWeight: 600 }}>{o.poolCount}</span>
            <span style={{ textAlign: 'right', color, fontSize: 13, textTransform: 'uppercase' }}>{o.poolStatus}</span>
          </div>
        )
      })}
    </div>
  )
}

function Timeline({ data }: { data: ScheduleDryRun }) {
  // 7 columns × 24h vertical timeline. Each period is positioned by its start/end seconds.
  // Hours rail on the left.
  const palette = useMemo(() => buildPalette(data), [data])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(7, 1fr)', gap: 6 }}>
      <div /> {/* spacer over hour rail */}
      {data.days.map((d) => (
        <div key={d.dayOfWeek} style={{
          fontFamily: T.mono, fontSize: 13, color: T.textDim,
          textTransform: 'uppercase', letterSpacing: 0.5,
          textAlign: 'center', paddingBottom: 4,
        }}>{d.label}</div>
      ))}

      <HourRail />
      {data.days.map((d) => (
        <DayColumn key={d.dayOfWeek} periods={d.periods} palette={palette} />
      ))}
    </div>
  )
}

function HourRail() {
  const lines = []
  for (let h = 0; h <= 24; h += 3) {
    lines.push(
      <div key={h} style={{
        position: 'absolute', top: `${(h * 60 / DAY_MINUTES) * 100}%`,
        right: 4, transform: 'translateY(-50%)',
        fontFamily: T.mono, fontSize: 12, color: T.textDim,
      }}>{String(h).padStart(2, '0')}:00</div>,
    )
  }
  return (
    <div style={{ position: 'relative', height: 480 }}>
      {lines}
    </div>
  )
}

function DayColumn({ periods, palette }: { periods: DryRunPeriod[]; palette: Map<string, string> }) {
  return (
    <div style={{
      position: 'relative', height: 480,
      border: `1px solid ${T.border}`, borderRadius: 3,
      background: T.surface, overflow: 'hidden',
    }}>
      {periods.map((p, i) => {
        const top = (p.startSec / 86400) * 100
        const height = ((p.endSec - p.startSec) / 86400) * 100
        const fill = p.source === 'gap' ? 'transparent'
          : p.source === 'default' ? T.surfaceRaised
          : palette.get(p.outcomeId!) ?? T.accent
        const color = p.source === 'gap' ? T.danger : T.bg
        const border = p.source === 'gap' ? `1px dashed ${T.danger}`
          : p.source === 'default' ? `1px dashed ${T.borderSubtle}`
          : `1px solid ${T.bg}`
        return (
          <div key={i} title={`${p.startHHMM}–${p.endHHMM} · ${labelOf(p)}`} style={{
            position: 'absolute', left: 0, right: 0,
            top: `${top}%`, height: `${height}%`,
            background: fill, color,
            border, boxSizing: 'border-box',
            fontFamily: T.mono, fontSize: 12,
            padding: '2px 4px',
            display: 'flex', flexDirection: 'column',
            justifyContent: 'flex-start',
            overflow: 'hidden',
            opacity: p.source === 'default' ? 0.55 : 1,
          }}>
            {height > 4 && (
              <>
                <div style={{ fontWeight: 600, color: p.source === 'gap' ? T.danger : T.bg }}>
                  {p.source === 'gap' ? 'GAP' : p.outcomeTitle}
                </div>
                {height > 8 && (
                  <div style={{ opacity: 0.85, fontSize: 10 }}>
                    {p.startHHMM}–{p.endHHMM}
                  </div>
                )}
              </>
            )}
            {p.overlap && (
              <div style={{
                position: 'absolute', top: 1, right: 2,
                fontSize: 10, color: T.danger, fontWeight: 700,
              }}>!</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────

function fmtDur(min: number): string {
  if (min === 0) return '0h'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h${m}m`
}

function pct(n: number, total: number): string {
  if (total === 0) return ''
  return `${Math.round((n / total) * 100)}%`
}

function labelOf(p: DryRunPeriod): string {
  if (p.source === 'gap') return 'gap (no default)'
  if (p.source === 'default') return `default · ${p.outcomeTitle}`
  return `scheduled · ${p.outcomeTitle}`
}

// Stable color per outcome id, reusing tokens that exist.
function buildPalette(data: ScheduleDryRun): Map<string, string> {
  const colors = [T.accent, '#7BA7C9', '#C9A77B', '#A77BC9', '#7BC9A7', '#C97B7B', '#7B7BC9']
  const map = new Map<string, string>()
  let i = 0
  for (const o of data.byOutcome) {
    map.set(o.outcomeId, colors[i % colors.length] ?? T.accent)
    i++
  }
  return map
}
