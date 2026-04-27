import type { ReactNode } from 'react'
import { T } from '../tokens.js'
import { S } from './sizes.js'

export function Section({ title, subtitle, children, columns }: {
  title?: string
  subtitle?: string
  children: ReactNode
  columns?: 1 | 2
}) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: S.r4,
      padding: 18,
    }}>
      {(title || subtitle) && (
        <div style={{ marginBottom: S.md }}>
          {title && (
            <div style={{
              fontSize: S.body,
              fontFamily: T.sans,
              fontWeight: 500,
              color: T.text,
            }}>{title}</div>
          )}
          {subtitle && (
            <div style={{
              fontSize: S.label,
              color: T.textDim,
              fontFamily: T.sans,
              marginTop: 3,
            }}>{subtitle}</div>
          )}
        </div>
      )}
      {columns === 2 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: S.md }}>
          {children}
        </div>
      ) : children}
    </div>
  )
}

export function Field({ label, children, full }: {
  label: string
  children: ReactNode
  full?: boolean
}) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
      <label style={{
        display: 'block',
        fontSize: S.label,
        color: T.textDim,
        fontFamily: T.sans,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: 4,
      }}>{label}</label>
      {children}
    </div>
  )
}

export function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr',
      gap: 10,
      padding: '4px 0',
      fontSize: S.small,
    }}>
      <span style={{
        color: T.textDim,
        fontFamily: T.sans,
        textTransform: 'uppercase',
        fontSize: S.label,
        letterSpacing: '0.04em',
      }}>{k}</span>
      <span style={{ color: T.text, fontFamily: mono ? T.mono : T.sans }}>{v}</span>
    </div>
  )
}
