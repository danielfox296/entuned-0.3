// Scoreboard — always-visible top strip of the Command Center.
//
// Pulls /command-center/scoreboard once on mount. Free / paid / MRR with a
// progress bar against this month's targets (100 free / 10 paid).

import { useEffect, useState } from 'react'
import { api, getToken, type CommandCenterScoreboard } from '../../api.js'
import { T } from '@entuned/tokens'

function pct(num: number, denom: number): number {
  if (denom <= 0) return 0
  return Math.min(100, Math.round((num / denom) * 100))
}

function dollarsFromCents(cents: number): string {
  if (cents === 0) return '$0'
  return `$${(cents / 100).toLocaleString('en-US')}`
}

export function Scoreboard() {
  const token = getToken()
  const [data, setData] = useState<CommandCenterScoreboard | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api.ccScoreboard(token).then(setData).catch((e) => setErr(String(e)))
  }, [token])

  const freePct = data ? pct(data.free, data.target.freeSignups) : 0
  const paidPct = data ? pct(data.paid, data.target.paidUsers) : 0

  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.border}`,
      borderRadius: 6, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
        <Metric label="Free" value={data ? String(data.free) : '—'} />
        <Metric label="Paid" value={data ? String(data.paid) : '—'} />
        <Metric label="MRR" value={data ? dollarsFromCents(data.mrr) : '—'} />
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: T.textFaint }}>
          Monthly target (spec, not a live counter): 100 free signups / 10 paid users
        </div>
      </div>
      {err && <div style={{ fontSize: 12, color: T.danger }}>{err}</div>}
      <ProgressBar label="Free signups" value={data?.free ?? 0} target={data?.target.freeSignups ?? 100} pct={freePct} />
      <ProgressBar label="Paid users" value={data?.paid ?? 0} target={data?.target.paidUsers ?? 10} pct={paidPct} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: T.textFaint, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, color: T.text, fontFamily: T.heading, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  )
}

function ProgressBar({ label, value, target, pct }: { label: string; value: number; target: number; pct: number }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.textDim, marginBottom: 3 }}>
        <span>{label}</span>
        <span>{value}/{target}</span>
      </div>
      <div style={{ height: 6, background: T.surface, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: pct >= 100 ? T.success : T.accent,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}
