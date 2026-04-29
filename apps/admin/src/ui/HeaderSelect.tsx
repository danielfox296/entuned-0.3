import { T } from '../tokens.js'
import { S } from './sizes.js'

export function HeaderSelect({ label, value, onChange, options, placeholder, disabled }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder: string
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontSize: S.label, color: T.textDim, fontFamily: T.sans,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          minWidth: 220, background: T.bg, color: T.text,
          border: `1px solid ${T.border}`, padding: '6px 10px',
          fontFamily: T.sans, fontSize: 14, borderRadius: S.r4,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
