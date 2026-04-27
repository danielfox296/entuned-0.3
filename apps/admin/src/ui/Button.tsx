import type { CSSProperties, ReactNode, MouseEventHandler } from 'react'
import { T } from '../tokens.js'
import { S } from './sizes.js'

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'tiny' | 'tinyDanger'

interface ButtonProps {
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  busy?: boolean
  variant?: ButtonVariant
  type?: 'button' | 'submit'
  title?: string
  style?: CSSProperties
}

export function Button({
  children, onClick, disabled, busy,
  variant = 'primary', type = 'button', title, style,
}: ButtonProps) {
  const inactive = disabled || busy
  const base = variantStyle(variant, !inactive)
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={inactive}
      title={title}
      style={{
        ...base,
        cursor: inactive ? 'default' : 'pointer',
        opacity: busy ? 0.6 : (disabled ? 0.4 : 1),
        ...style,
      }}
    >
      {children}
    </button>
  )
}

function variantStyle(v: ButtonVariant, active: boolean): CSSProperties {
  switch (v) {
    case 'primary':
      return {
        background: active ? T.accent : T.surfaceRaised,
        color: active ? T.bg : T.textMuted,
        border: 'none',
        borderRadius: S.r4,
        padding: '8px 16px',
        fontFamily: T.sans,
        fontSize: S.small,
        fontWeight: 600,
      }
    case 'ghost':
      return {
        background: 'transparent',
        border: `1px solid ${T.border}`,
        color: T.textMuted,
        padding: '6px 12px',
        borderRadius: S.r3,
        fontFamily: T.sans,
        fontSize: S.small,
      }
    case 'danger':
      return {
        background: 'transparent',
        border: `1px solid ${T.danger}`,
        color: T.danger,
        padding: '6px 12px',
        borderRadius: S.r3,
        fontFamily: T.sans,
        fontSize: S.small,
      }
    case 'tiny':
      return {
        background: 'transparent',
        border: `1px solid ${T.border}`,
        color: T.textMuted,
        padding: '3px 10px',
        borderRadius: S.r2,
        fontFamily: T.sans,
        fontSize: S.label,
      }
    case 'tinyDanger':
      return {
        background: 'transparent',
        border: `1px solid ${T.danger}`,
        color: T.danger,
        padding: '3px 10px',
        borderRadius: S.r2,
        fontFamily: T.sans,
        fontSize: S.label,
      }
  }
}
