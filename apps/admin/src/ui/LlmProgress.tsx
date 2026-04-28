import { useEffect, useState } from 'react'
import { T } from '../tokens.js'

/**
 * Reusable progress indicator for LLM calls. Animates to 95% over the
 * supplied ETA, holds there, then jumps to 100% when `done` flips true.
 * If the call overruns the ETA, switches to a "taking longer…" message.
 *
 * Usage:
 *   const [busy, setBusy] = useState(false)
 *   ...
 *   {busy && <LlmProgress etaSeconds={n * 4} label="generating hooks" />}
 */
export function LlmProgress({ etaSeconds, label, done = false }: {
  etaSeconds: number
  label: string
  done?: boolean
}) {
  const [pct, setPct] = useState(0)
  const [overran, setOverran] = useState(false)

  useEffect(() => {
    if (done) { setPct(100); return }
    const startedAt = Date.now()
    const total = Math.max(1, etaSeconds) * 1000
    let raf = 0
    const tick = () => {
      const elapsed = Date.now() - startedAt
      const linear = Math.min(0.95, elapsed / total)
      // Slight ease-out so the bar doesn't slam against 95%.
      const eased = 1 - Math.pow(1 - linear, 1.5)
      setPct(Math.min(95, eased * 100))
      if (elapsed > total) setOverran(true)
      if (!done && elapsed < total + 60_000) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [etaSeconds, done])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '8px 12px', background: T.surfaceRaised,
      border: `1px solid ${T.borderSubtle}`, borderRadius: 4,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontFamily: T.mono, fontSize: 12, color: T.textDim,
      }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}{overran && !done ? ' · taking longer than expected' : ''}
        </span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div style={{
        height: 4, background: T.bg, borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: T.accent,
          transition: 'width 120ms linear',
        }} />
      </div>
    </div>
  )
}
