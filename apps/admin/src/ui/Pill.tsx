import type { ReactNode } from 'react'
import { T } from '../tokens.js'

export type PillTone = 'success' | 'warn' | 'danger' | 'accent' | 'muted' | 'dim'
export type PillVariant = 'outline' | 'soft'

export function Pill({
  tone = 'muted',
  variant = 'outline',
  uppercase,
  children,
}: {
  tone?: PillTone
  variant?: PillVariant
  uppercase?: boolean
  children: ReactNode
}) {
  const c = colorFor(tone)
  const soft = variant === 'soft'
  return (
    <span style={{
      fontSize: 11,
      fontFamily: T.sans,
      fontWeight: 600,
      letterSpacing: uppercase ? '0.06em' : undefined,
      textTransform: uppercase ? 'uppercase' : undefined,
      color: soft ? c : c,
      background: soft ? withAlpha(c, 0.16) : 'transparent',
      border: soft ? '1px solid transparent' : `1px solid ${c}`,
      borderRadius: 999,
      padding: '2px 8px',
      whiteSpace: 'nowrap',
      display: 'inline-block',
      lineHeight: 1.4,
    }}>{children}</span>
  )
}

function colorFor(tone: PillTone): string {
  switch (tone) {
    case 'success': return T.success
    case 'warn':    return T.warn
    case 'danger':  return T.danger
    case 'accent':  return T.accent
    case 'muted':   return T.accent
    case 'dim':     return T.textDim
  }
}

// Hex (#rrggbb) or rgba color → rgba with given alpha.
function withAlpha(c: string, a: number): string {
  if (c.startsWith('rgba')) return c.replace(/[\d.]+\)$/, `${a})`)
  if (c.startsWith('rgb('))  return c.replace('rgb(', 'rgba(').replace(')', `, ${a})`)
  if (c.startsWith('#') && c.length === 7) {
    const r = parseInt(c.slice(1, 3), 16)
    const g = parseInt(c.slice(3, 5), 16)
    const b = parseInt(c.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  return c
}

