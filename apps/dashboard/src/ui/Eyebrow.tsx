import type { ReactNode } from 'react'
import { T } from '../tokens.js'

// Small uppercase label used above section headlines. Pattern lifted from the
// PLG onboarding design — pairs with a Manrope display headline below.
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span style={{
      display: 'block',
      fontFamily: T.sans,
      fontSize: 11,
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: '0.18em',
      color: T.accent,
      marginBottom: 12,
    }}>
      {children}
    </span>
  )
}
