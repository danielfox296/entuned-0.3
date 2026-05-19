// Collapsible section wrapper used by every Command Center subsystem.
//
// Each section title shows the icon + label + count badge, and click-toggles
// open/closed. `defaultOpen` lets the page open Signals + Outreach by default
// (the two highest-leverage sections in the spec).
//
// `onRunNow` adds a "Run now" button to the header. The button fires
// outside the toggle area (stopPropagation) so clicking it doesn't also
// collapse the section. Shows a spinner while the worker runs and a toast
// with the result.

import { useState, type ReactNode } from 'react'
import { T } from '@entuned/tokens'
import { useToast } from '../../ui/index.js'

export function Section({
  title,
  icon,
  count,
  defaultOpen,
  onRunNow,
  children,
}: {
  title: string
  icon?: ReactNode
  count?: number
  defaultOpen?: boolean
  onRunNow?: () => Promise<{ summary: string }>
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [running, setRunning] = useState(false)
  const toast = useToast()

  async function handleRun(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onRunNow || running) return
    setRunning(true)
    try {
      const result = await onRunNow()
      toast.success(result.summary)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setRunning(false)
    }
  }

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
        {onRunNow && (
          <button
            onClick={handleRun}
            disabled={running}
            style={{
              marginLeft: 'auto',
              background: running ? 'transparent' : T.accentGlow,
              color: running ? T.textDim : T.accent,
              border: `1px solid ${T.accentMuted}`,
              padding: '3px 10px', fontSize: 11, fontFamily: T.mono,
              borderRadius: 3, cursor: running ? 'wait' : 'pointer',
            }}
          >
            {running ? 'Running…' : 'Run now'}
          </button>
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
