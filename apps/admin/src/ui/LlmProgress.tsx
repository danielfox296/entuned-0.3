import { useEffect, useState } from 'react'
import { T } from '../tokens.js'

/**
 * Reusable progress indicator for LLM calls. Animates to 95% over the
 * supplied ETA, holds there, then jumps to 100% when `done` flips true.
 * The bar always also renders an animated stripe overlay so movement is
 * visible even when the numeric percent is a rough estimate.
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
      <KeyframeStyles />
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
        position: 'relative',
        height: 8, minHeight: 8, flexShrink: 0,
        background: T.bg, borderRadius: 4, overflow: 'hidden',
        border: `1px solid ${T.borderSubtle}`,
      }}>
        {/* Filled portion */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: `${pct}%`, background: T.accent,
          transition: 'width 120ms linear',
        }} />
        {/* Animated stripe overlay so movement is always visible. */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: `${pct}%`,
          backgroundImage: `linear-gradient(135deg, rgba(255,255,255,0.25) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.25) 75%, transparent 75%, transparent)`,
          backgroundSize: '16px 16px',
          animation: done ? 'none' : 'llm-progress-stripe 700ms linear infinite',
          transition: 'width 120ms linear',
          pointerEvents: 'none',
        }} />
      </div>
    </div>
  )
}

/** Inject the keyframe rule once. The codebase uses inline styles, so we
 *  attach the animation via a <style> tag rendered alongside the bar. */
function KeyframeStyles() {
  return (
    <style>{`
      @keyframes llm-progress-stripe {
        from { background-position: 0 0; }
        to { background-position: 16px 0; }
      }
    `}</style>
  )
}
