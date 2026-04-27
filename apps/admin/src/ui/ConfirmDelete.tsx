import { useState } from 'react'
import type { ReactNode } from 'react'
import { T } from '../tokens.js'
import { S } from './sizes.js'
import { Button } from './Button.js'

interface ConfirmDeleteProps {
  label?: string
  entity: ReactNode
  busy?: boolean
  onConfirm: () => void
}

// House rule for destructive actions:
//   - Never on a list row.
//   - Only behind expansion / detail.
//   - Two-step: ghost label → solid confirm with the entity named.
export function ConfirmDelete({ label = 'Delete', entity, busy, onConfirm }: ConfirmDeleteProps) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return <Button variant="danger" onClick={() => setArmed(true)}>{label}</Button>
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
      <span style={{ fontSize: S.label, color: T.textDim, fontFamily: T.sans }}>
        Delete <strong style={{ color: T.text }}>{entity}</strong>?
      </span>
      <button
        onClick={onConfirm}
        disabled={busy}
        style={{
          background: T.danger, color: '#fff', border: 'none',
          padding: '6px 12px', borderRadius: S.r3,
          fontFamily: T.sans, fontSize: S.small, fontWeight: 600,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
        }}
      >{busy ? 'deleting…' : 'Confirm delete'}</button>
      <Button variant="ghost" onClick={() => setArmed(false)} disabled={busy}>Cancel</Button>
    </div>
  )
}
