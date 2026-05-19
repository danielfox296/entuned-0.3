// Shared action-bar for queue items.
//
// Every actionable item in the command center exposes a consistent set of
// buttons. Which buttons appear is context-dependent — callers pass the
// handlers they want enabled and the bar renders only those.
//
// Daniel never sends from the command center. Buttons stage actions:
// copy to clipboard, open the source URL in a new tab, mark sent (status
// transition), skip, snooze. The actual send is always external.

import type { ReactNode } from 'react'
import { T } from '@entuned/tokens'

export interface ActionBarProps {
  onEdit?: () => void
  onCopy?: () => void
  onOpen?: () => void
  onApprove?: () => void
  onSend?: () => void
  onSkip?: () => void
  onSnooze?: () => void
  onDelete?: () => void
  busy?: boolean
}

export function ActionBar(props: ActionBarProps) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {props.onEdit && <Btn onClick={props.onEdit} busy={props.busy}>Edit</Btn>}
      {props.onCopy && <Btn onClick={props.onCopy} busy={props.busy}>Copy</Btn>}
      {props.onOpen && <Btn onClick={props.onOpen} busy={props.busy}>Open ↗</Btn>}
      {props.onApprove && <Btn onClick={props.onApprove} busy={props.busy} variant="primary">Approve</Btn>}
      {props.onSend && <Btn onClick={props.onSend} busy={props.busy} variant="primary">Mark sent</Btn>}
      {props.onSkip && <Btn onClick={props.onSkip} busy={props.busy} variant="muted">Skip</Btn>}
      {props.onSnooze && <Btn onClick={props.onSnooze} busy={props.busy} variant="muted">Snooze 1w</Btn>}
      {props.onDelete && <Btn onClick={props.onDelete} busy={props.busy} variant="danger">Delete</Btn>}
    </div>
  )
}

function Btn({
  onClick, children, busy, variant,
}: {
  onClick: () => void
  children: ReactNode
  busy?: boolean
  variant?: 'primary' | 'muted' | 'danger'
}) {
  const styles: Record<string, { bg: string; fg: string; border: string }> = {
    primary: { bg: T.accentGlow, fg: T.accent, border: T.accentMuted },
    muted: { bg: 'transparent', fg: T.textDim, border: T.borderSubtle },
    danger: { bg: 'transparent', fg: T.danger, border: 'rgba(226, 75, 74, 0.3)' },
    default: { bg: T.surface, fg: T.text, border: T.border },
  }
  const s = styles[variant ?? 'default'] ?? styles.default
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      style={{
        background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
        padding: '4px 10px', fontSize: 12, fontFamily: T.sans,
        borderRadius: 3, cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
