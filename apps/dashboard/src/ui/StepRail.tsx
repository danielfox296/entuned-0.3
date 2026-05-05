import { T } from '../tokens.js'

// Friendly horizontal step rail. Pulled from the PLG onboarding design after
// the user rejected the techy "01 · Account" / dot-only versions:
//   - every step is a labelled pill (sentence case)
//   - completed steps get a filled gold check
//   - current step is highlighted in gold with a filled dot
//   - future steps are quietly muted, non-clickable
//   - row stays single-line; long rails will horizontally clip rather than wrap

export interface StepDef {
  id: string
  label: string
}

interface Props {
  steps: StepDef[]
  current: number
  onJump?: (index: number) => void
}

export function StepRail({ steps, current, onJump }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2,
      flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0,
    }}>
      {steps.map((s, i) => {
        const done = i < current
        const isCurrent = i === current
        const color = isCurrent ? T.text : done ? T.textDim : T.textFaint
        const bg = isCurrent ? T.accentGlow : 'transparent'
        const border = isCurrent ? `1px solid ${T.borderActive}` : '1px solid transparent'
        const clickable = done && !!onJump
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => clickable && onJump!(i)}
            disabled={!clickable && !isCurrent}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: bg, border,
              padding: '6px 10px',
              borderRadius: 999,
              color,
              fontFamily: T.sans,
              fontSize: 13,
              fontWeight: isCurrent ? 500 : 400,
              cursor: clickable ? 'pointer' : 'default',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: done ? T.accent : 'transparent',
              border: isCurrent
                ? `1.5px solid ${T.accent}`
                : done ? 'none' : `1.5px solid ${T.border}`,
            }}>
              {done ? (
                <svg width="9" height="9" viewBox="0 0 10 10">
                  <polyline points="2,5 4.2,7 8,3" fill="none"
                    stroke={T.bg} strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : isCurrent ? (
                <span style={{
                  width: 6, height: 6, background: T.accent, borderRadius: '50%',
                }} />
              ) : null}
            </span>
            <span>{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}
