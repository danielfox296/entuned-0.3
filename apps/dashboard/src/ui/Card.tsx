import type { ReactNode, CSSProperties } from 'react'
import { T } from '../tokens.js'

export function Card({ children, title, subtitle, style }: {
  children: ReactNode
  title?: string
  subtitle?: string
  style?: CSSProperties
}) {
  return (
    <div style={{
      background: T.surfaceRaised,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: 24,
      ...style,
    }}>
      {(title || subtitle) && (
        <div style={{ marginBottom: 16 }}>
          {title && (
            <div style={{
              fontSize: 17,
              fontFamily: T.sans,
              fontWeight: 500,
              color: T.text,
            }}>{title}</div>
          )}
          {subtitle && (
            <div style={{
              fontSize: 13,
              color: T.textDim,
              fontFamily: T.sans,
              marginTop: 4,
            }}>{subtitle}</div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

// Empty-state placeholder — used on every list-style route until the wired
// data lands. Keep copy operator-tone, not marketing.
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: 28,
      background: T.accentGlow,
      border: `1px dashed ${T.accentMuted}`,
      borderRadius: 12,
      color: T.textMuted,
      fontFamily: T.sans,
      fontSize: 14,
      lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}
