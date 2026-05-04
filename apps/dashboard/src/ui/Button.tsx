import type { CSSProperties, ReactNode, MouseEventHandler } from 'react'
import { T } from '../tokens.js'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'

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
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={inactive}
      title={title}
      style={{
        ...variantStyle(variant, !inactive),
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
        borderRadius: 4,
        padding: '10px 18px',
        fontFamily: T.sans,
        fontSize: 14,
        fontWeight: 600,
      }
    case 'ghost':
      return {
        background: 'transparent',
        border: `1px solid ${T.border}`,
        color: T.textMuted,
        padding: '8px 14px',
        borderRadius: 3,
        fontFamily: T.sans,
        fontSize: 14,
      }
    case 'danger':
      return {
        background: 'transparent',
        border: `1px solid ${T.danger}`,
        color: T.danger,
        padding: '8px 14px',
        borderRadius: 3,
        fontFamily: T.sans,
        fontSize: 14,
      }
  }
}
