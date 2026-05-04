import type { CSSProperties, InputHTMLAttributes } from 'react'
import { T } from '../tokens.js'

const baseField: CSSProperties = {
  background: T.surfaceRaised,
  border: `1px solid ${T.border}`,
  color: T.text,
  fontFamily: T.sans,
  fontSize: 15,
  padding: '10px 12px',
  borderRadius: 4,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      style={{ ...baseField, ...style }}
      onFocus={(e) => { e.currentTarget.style.borderColor = T.accent }}
      onBlur={(e) => { e.currentTarget.style.borderColor = T.border }}
    />
  )
}
