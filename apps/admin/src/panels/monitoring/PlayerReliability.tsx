import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { ReliabilitySummaryResponse } from '../../api.js'
import { T } from '../../tokens.js'
import { Button } from '../../ui/index.js'

type WindowDays = 1 | 7 | 28 | 90

// Player Reliability — surfaces phase-1 + phase-2 telemetry (lockscreen /
// wake-lock / visibility / stall / PWA-install / audio cache / web push).
// Empty cells stay blank rather than showing zeros so first-week noise
// doesn't masquerade as signal.
export function PlayerReliability() {
  const [windowDays, setWindowDays] = useState<WindowDays>(7)
  const [data, setData] = useState<ReliabilitySummaryResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (w: WindowDays) => {
    const token = getToken(); if (!token) return
    setLoading(true); setErr(null)
    try { setData(await api.reliabilitySummary(w, token)) }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load(windowDays) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onWindow = (w: WindowDays) => { setWindowDays(w); void load(w) }

  const stores = data?.stores ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'center', borderBottom: `1px solid ${T.borderSubtle}`,
        paddingBottom: 12,
      }}>
        <div style={{ flex: 1, fontFamily: T.sans, fontSize: 14, color: T.textMuted }}>
          Per-store rollup of player reliability telemetry. Higher
          interruptions-per-session and lower install adoption are leading
          indicators that a store needs the PWA-install nudge or a native wrapper.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {([1, 7, 28, 90] as WindowDays[]).map((w) => (
            <button key={w} onClick={() => onWindow(w)} style={{
              background: windowDays === w ? T.surfaceRaised : 'transparent',
              border: `1px solid ${windowDays === w ? T.accent : T.border}`,
              color: windowDays === w ? T.accent : T.textMuted,
              padding: '4px 10px', borderRadius: 4,
              fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
            }}>{w}d</button>
          ))}
          <Button variant="ghost" onClick={() => load(windowDays)}>refresh</Button>
        </div>
      </div>

      {err && <div style={{ color: T.danger, fontFamily: T.sans, fontSize: 13 }}>{err}</div>}
      {loading && !data && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: 13 }}>Loading…</div>}

      {data && stores.length === 0 && (
        <div style={{ padding: 24, background: T.accentGlow, border: `1px dashed ${T.accentMuted}`, borderRadius: 6 }}>
          <div style={{ fontFamily: T.sans, fontSize: 14, color: T.textMuted }}>
            No reliability events in the last {windowDays} day{windowDays === 1 ? '' : 's'}.
            New telemetry types started flowing on 2026-05-16 — give it a few days of operator activity.
          </div>
        </div>
      )}

      {stores.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontFamily: T.sans, fontSize: 13, color: T.text,
          }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.surfaceRaised }}>
                <th style={thStyle}>Store</th>
                <th style={thStyleR}>Songs<br/>started</th>
                <th style={thStyleR} title="Suspected interruption events (audio stopped while hidden without an operator pause) divided by song_start count">Interrupt /<br/>session</th>
                <th style={thStyleR} title="Stalls = audio frozen ≥6s while Howler claims to be playing">Stalls</th>
                <th style={thStyleR} title="Wake-lock request failures (old iOS, denied, etc.)">Wake<br/>fails</th>
                <th style={thStyleR} title="Share of pwa_standalone_launch events with is_standalone=true">Install<br/>adoption</th>
                <th style={thStyleR} title="Share of play/pause/skip that came in via lockscreen vs in-app controls">OS-ctrl<br/>share</th>
                <th style={thStyleR} title="Audio cache hit ratio. Low miss = good prefetch coverage.">Cache<br/>hit %</th>
                <th style={thStyleR} title="Active Web Push enrollments minus unsubscribes within window">Push<br/>net</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.storeId} style={{ borderBottom: `1px solid ${T.borderSubtle}` }}>
                  <td style={tdStyle}>
                    <div style={{ color: T.text }}>{s.storeName}</div>
                    <div style={{ color: T.textDim, fontSize: 11 }}>
                      {s.clientName ? `${s.clientName} · ` : ''}{s.tier ?? ''}
                    </div>
                  </td>
                  <td style={tdStyleR}>{s.songStarts || '—'}</td>
                  <td style={tdStyleR}>{s.songStarts > 0 ? pct(s.interruptionsPerSession) : '—'}</td>
                  <td style={tdStyleR}>{s.stalls || '—'}</td>
                  <td style={tdStyleR}>{s.wakeLockFailures || '—'}</td>
                  <td style={tdStyleR}>{(s.standaloneInstalled + s.standaloneTab) > 0 ? pct(s.standaloneAdoption) : '—'}</td>
                  <td style={tdStyleR}>{(s.osMediatedControlShare > 0 || s.songStarts > 0) ? pct(s.osMediatedControlShare) : '—'}</td>
                  <td style={tdStyleR}>{(s.cacheHits + s.cacheMisses) > 0 ? pct(s.cacheHitRate) : '—'}</td>
                  <td style={tdStyleR}>{s.pushSubscribed - s.pushUnsubscribed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const thStyle = {
  textAlign: 'left' as const,
  padding: '10px 12px',
  fontWeight: 500,
  color: T.textMuted,
  fontSize: 12,
}
const thStyleR = { ...thStyle, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
const tdStyle = { padding: '10px 12px', verticalAlign: 'top' as const }
const tdStyleR = { ...tdStyle, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}
