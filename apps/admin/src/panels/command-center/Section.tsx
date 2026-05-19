// Collapsible section wrapper used by every Command Center subsystem.
//
// Each section title shows the icon + label + count badge, and click-toggles
// open/closed. `defaultOpen` lets the page open Signals + Outreach by default
// (the two highest-leverage sections in the spec).

import { useState, type ReactNode } from 'react'
import { T } from '@entuned/tokens'

export function Section({
  title,
  icon,
  count,
  defaultOpen,
  children,
}: {
  title: string
  icon?: ReactNode
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 6,
      background: T.surfaceRaised, marginBottom: 12,
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', cursor: 'pointer',
          borderBottom: open ? `1px solid ${T.borderSubtle}` : 'none',
        }}
      >
        <span style={{ color: T.textFaint, fontSize: 12, width: 12 }}>{open ? '▾' : '▸'}</span>
        {icon && <span style={{ color: T.accent, display: 'inline-flex' }}>{icon}</span>}
        <span style={{
          fontSize: 14, color: T.text, fontFamily: T.sans, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{title}</span>
        {count !== undefined && (
          <span style={{
            fontSize: 11, color: count > 0 ? T.accent : T.textFaint,
            background: count > 0 ? T.accentGlow : 'transparent',
            padding: '1px 8px', borderRadius: 10,
            border: `1px solid ${count > 0 ? T.borderSubtle : 'transparent'}`,
            fontFamily: T.mono,
          }}>{count}</span>
        )}
      </div>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      padding: '16px 12px', textAlign: 'center',
      color: T.textFaint, fontSize: 13, fontFamily: T.sans,
      fontStyle: 'italic',
    }}>{message}</div>
  )
}
