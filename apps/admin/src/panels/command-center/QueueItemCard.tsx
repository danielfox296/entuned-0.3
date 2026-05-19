// One row in any queue section.
//
// Renders the QueueItem title + subtype/priority pills, expandable draft
// content + payload preview, and the shared ActionBar. Context-specific
// callers pass in which actions to enable.

import { useState } from 'react'
import type { QueueItemRow } from '../../api.js'
import { T } from '@entuned/tokens'
import { ActionBar, type ActionBarProps } from './ActionBar.js'

export interface QueueItemCardProps {
  item: QueueItemRow
  actions: ActionBarProps
  // If true, payload is JSON-stringified and rendered inside the expand view.
  showPayload?: boolean
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function QueueItemCard({ item, actions, showPayload }: QueueItemCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 4,
      padding: 12, marginBottom: 8, background: T.surface,
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      >
        <span style={{ color: T.textFaint, fontSize: 12 }}>{expanded ? '▾' : '▸'}</span>
        {item.subtype && (
          <span style={{
            fontSize: 11, color: T.accent, fontFamily: T.mono,
            background: T.accentGlow, padding: '1px 6px', borderRadius: 3,
            border: `1px solid ${T.borderSubtle}`,
          }}>{item.subtype}</span>
        )}
        <span style={{ flex: 1, fontSize: 14, color: T.text, fontFamily: T.sans }}>
          {item.title}
        </span>
        {item.priority > 0 && (
          <span style={{ fontSize: 11, color: T.gold, fontFamily: T.mono }}>p{item.priority}</span>
        )}
        <span style={{ fontSize: 11, color: T.textFaint }}>{timeAgo(item.createdAt)}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, paddingLeft: 20 }}>
          {item.sourceUrl && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: T.textFaint }}>Source: </span>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: T.accent, wordBreak: 'break-all' }}
              >{item.sourceUrl}</a>
            </div>
          )}
          {item.draftContent && (
            <div style={{
              background: T.inkDeep, border: `1px solid ${T.borderSubtle}`,
              padding: 10, borderRadius: 3, marginBottom: 8,
              fontFamily: T.sans, fontSize: 13, color: T.textMuted,
              whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto',
            }}>
              {item.draftContent}
            </div>
          )}
          {showPayload && item.payload && (
            <details style={{ marginBottom: 8 }}>
              <summary style={{ fontSize: 11, color: T.textFaint, cursor: 'pointer' }}>payload</summary>
              <pre style={{
                fontSize: 11, color: T.textDim, background: T.inkDeep,
                padding: 8, borderRadius: 3, marginTop: 4,
                maxHeight: 200, overflow: 'auto',
              }}>{JSON.stringify(item.payload, null, 2)}</pre>
            </details>
          )}
          <ActionBar {...actions} />
        </div>
      )}
    </div>
  )
}
