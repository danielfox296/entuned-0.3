import type { CSSProperties, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'
import { T } from '../tokens.js'
import { S } from './sizes.js'

const baseField: CSSProperties = {
  background: T.surfaceRaised,
  border: `1px solid ${T.border}`,
  color: T.text,
  fontFamily: T.sans,
  fontSize: S.small,
  padding: '7px 10px',
  borderRadius: S.r3,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

// Single shared focus-ring approach via inline + onFocus/onBlur — keeps
// keyboard a11y without global CSS.
function focusableProps(extra?: CSSProperties) {
  return {
    style: { ...baseField, ...extra },
    onFocus: (e: any) => { e.currentTarget.style.borderColor = T.accent },
    onBlur:  (e: any) => { e.currentTarget.style.borderColor = T.border },
  }
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { width?: number | string }

export function Input({ width, style, ...rest }: InputProps) {
  const f = focusableProps(width != null ? { width } : undefined)
  return <input {...rest} style={{ ...f.style, ...style }} onFocus={f.onFocus} onBlur={f.onBlur} />
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ style, ...rest }: TextareaProps) {
  const f = focusableProps({ resize: 'vertical', lineHeight: 1.5 })
  return <textarea {...rest} style={{ ...f.style, ...style }} onFocus={f.onFocus} onBlur={f.onBlur} />
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  width?: number | string
  children: ReactNode
}

export function Select({ children, width, style, ...rest }: SelectProps) {
  const f = focusableProps(width != null ? { width } : undefined)
  return (
    <select {...rest} style={{ ...f.style, ...style }} onFocus={f.onFocus} onBlur={f.onBlur}>
      {children}
    </select>
  )
}
