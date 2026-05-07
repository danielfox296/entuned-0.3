import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ArrowRight } from 'lucide-react'
import { T } from '../tokens.js'
import { api, TIER_RANK, type Tier } from '../api.js'

// SetupChecklist — visible progress against onboarding's load-bearing steps.
// People finish what they can see a progress bar for. Lifted from the PLG
// onboarding design's post-onboarding pattern. Steps adjust to tier so a
// free user never sees ICP listed (locked for them anyway).

interface Step {
  id: string
  label: string
  to: string
  done: boolean
  hide?: boolean
}

interface Props {
  tier: Tier
  hasLocation: boolean
}

export function SetupChecklist({ tier, hasLocation }: Props) {
  const isPaid = TIER_RANK[tier] >= TIER_RANK.core
  const [icpFilled, setIcpFilled] = useState(false)
  const [icpChecked, setIcpChecked] = useState(false)

  useEffect(() => {
    if (!isPaid) { setIcpChecked(true); return }
    let cancelled = false
    api.meIcp()
      .then((r) => {
        if (cancelled) return
        setIcpFilled(!!r.icp && (r.icp.name ?? '').trim().length > 0)
      })
      .catch(() => { /* leave at false; checklist still shows the step */ })
      .finally(() => { if (!cancelled) setIcpChecked(true) })
    return () => { cancelled = true }
  }, [isPaid])

  const steps: Step[] = [
    { id: 'account',  label: 'Create your account',         to: '/account',   done: true },
    { id: 'location', label: 'Add your first location',     to: '/locations', done: hasLocation },
    { id: 'icp',      label: 'Tell us about your audience', to: '/intake',    done: icpFilled, hide: !isPaid },
  ]

  const visible = steps.filter((s) => !s.hide)
  const doneCount = visible.filter((s) => s.done).length
  const total = visible.length
  const allDone = doneCount === total

  // Once everything's done, fade out — the checklist's job is finished.
  if (allDone || !icpChecked) return null

  return (
    <div style={{
      background: T.surfaceRaised,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: 24,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 16, gap: 12,
      }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 500, letterSpacing: '0.18em',
            color: T.accent, textTransform: 'uppercase', marginBottom: 6,
          }}>
            Your setup
          </div>
          <div style={{
            fontFamily: T.heading, fontSize: 18, fontWeight: 600,
            color: T.text, letterSpacing: '-0.01em',
          }}>
            {doneCount} of {total} complete
          </div>
        </div>
        <ProgressBar done={doneCount} total={total} />
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {visible.map((s) => (
          <ChecklistRow key={s.id} step={s} />
        ))}
      </div>
    </div>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : (done / total) * 100
  return (
    <div style={{
      width: 120, height: 4,
      background: T.borderSubtle,
      borderRadius: 6, overflow: 'hidden',
    }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: T.accent,
        transition: 'width 0.3s ease',
      }} />
    </div>
  )
}

function ChecklistRow({ step }: { step: Step }) {
  const inner = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px',
      background: step.done ? 'transparent' : T.surface,
      border: `1px solid ${step.done ? T.borderSubtle : T.border}`,
      borderRadius: 10,
      textDecoration: 'none',
      color: T.text,
      transition: 'border-color 0.15s ease',
    }}>
      <span style={{
        width: 18, height: 18, flexShrink: 0,
        borderRadius: '50%',
        background: step.done ? T.accent : 'transparent',
        border: step.done ? 'none' : `1.5px solid ${T.border}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {step.done && (
          <Check size={11} strokeWidth={2.5} color={T.bg} />
        )}
      </span>
      <span style={{
        flex: 1, fontSize: 14,
        color: step.done ? T.textFaint : T.text,
        textDecoration: step.done ? 'line-through' : 'none',
      }}>
        {step.label}
      </span>
      {!step.done && (
        <ArrowRight size={14} strokeWidth={1.75} color={T.accent} />
      )}
    </div>
  )

  if (step.done) return inner
  return (
    <Link to={step.to} style={{ textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </Link>
  )
}
