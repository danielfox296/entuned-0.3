import type { ReactNode } from 'react'
import { T } from '../tokens.js'
import { S } from './sizes.js'

export type PillTone = 'success' | 'warn' | 'danger' | 'accent' | 'muted' | 'dim'

export function Pill({ tone = 'muted', children }: { tone?: PillTone; children: ReactNode }) {
  const c = colorFor(tone)
  return (
    <span style={{
      fontSize: S.label,
      fontFamily: T.sans,
      color: c,
      border: `1px solid ${c}`,
      borderRadius: S.r3,
      padding: '2px 8px',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function colorFor(tone: PillTone): string {
  switch (tone) {
    case 'success': return T.success
    case 'warn':    return T.warn
    case 'danger':  return T.danger
    case 'accent':  return T.accent
    case 'muted':   return T.accentMuted
    case 'dim':     return T.textDim
  }
}
