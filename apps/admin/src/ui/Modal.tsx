import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { T } from '../tokens.js'

/**
 * Lightweight in-viewport modal. Click backdrop or press Escape to close.
 */
export function Modal({ open, onClose, title, children, footer, width = 720 }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, maxHeight: '90vh',
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 6, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${T.borderSubtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontFamily: T.heading, fontSize: 16, fontWeight: 600, color: T.text }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: T.textMuted,
              cursor: 'pointer', fontFamily: T.mono, fontSize: 13, padding: '4px 8px',
            }}
          >close ✕</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{
            padding: '12px 18px', borderTop: `1px solid ${T.borderSubtle}`,
            display: 'flex', justifyContent: 'flex-end', gap: 8,
          }}>{footer}</div>
        )}
      </div>
    </div>
  )
}
