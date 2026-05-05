import { useRef, type ReactNode } from 'react'
import { T } from '../tokens.js'

// 1–5 spectrum slider with labelled poles. Lifted from the PLG onboarding
// design; click anywhere on the track to set a value. Optional `note` prints
// a small italic citation under the track (e.g. for research notes).

interface Props {
  label: ReactNode
  sub?: ReactNode
  leftLabel: ReactNode
  rightLabel: ReactNode
  value: number
  onChange: (v: number) => void
  note?: ReactNode
}

export function SpectrumSlider({
  label, sub, leftLabel, rightLabel, value, onChange, note,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)

  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    const x = (e.clientX - r.left) / r.width
    const v = Math.max(1, Math.min(5, Math.round(x * 4) + 1))
    onChange(v)
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 8,
      }}>
        <span style={{
          fontFamily: T.heading, fontSize: 18, fontWeight: 600, color: T.text,
        }}>{label}</span>
        {sub && (
          <span style={{ fontSize: 13, color: T.textFaint }}>{sub}</span>
        )}
      </div>
      <div
        ref={trackRef}
        onClick={onTrackClick}
        style={{
          position: 'relative', height: 40, cursor: 'pointer',
          display: 'flex', alignItems: 'center',
        }}
      >
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%', height: 1,
          background: T.border,
        }} />
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n === value
          return (
            <div
              key={n}
              style={{
                position: 'absolute',
                left: `${(n - 1) * 25}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: active ? 14 : 6,
                height: active ? 14 : 6,
                borderRadius: '50%',
                background: active ? T.accent : T.border,
                transition: 'all 0.15s ease',
                boxShadow: active ? `0 0 0 6px ${T.accentGlow}` : 'none',
              }}
            />
          )
        })}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 8,
      }}>
        <span style={{
          fontSize: 12, letterSpacing: '0.06em',
          color: value <= 2 ? T.text : T.textFaint,
        }}>
          {leftLabel}
        </span>
        <span style={{
          fontSize: 12, letterSpacing: '0.06em',
          color: value >= 4 ? T.text : T.textFaint,
        }}>
          {rightLabel}
        </span>
      </div>
      {note && (
        <div style={{
          marginTop: 12, paddingLeft: 12,
          borderLeft: `2px solid ${T.borderActive}`,
          fontSize: 12, color: T.textFaint, fontStyle: 'italic',
        }}>
          {note}
        </div>
      )}
    </div>
  )
}
