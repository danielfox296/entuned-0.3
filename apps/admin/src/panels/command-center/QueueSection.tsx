// Generic queue section — used by Signals, Outreach, Triggers.
//
// Owns: fetching items of a given type, rendering cards with the right
// action set, mutating items (status / draftContent), refreshing.
//
// Daniel does NOT send from here. "Copy" puts draftContent on clipboard;
// "Open" launches the source URL in a new tab; "Mark sent" stamps acted_at
// in the DB. The actual outgoing email / Reddit reply / form submit happens
// outside the app — that's the spec's deliberate decision.

import { useEffect, useState, type ReactNode } from 'react'
import { api, getToken, type QueueItemRow } from '../../api.js'
import { useToast } from '../../ui/index.js'
import { Section, EmptyState } from './Section.js'
import { QueueItemCard } from './QueueItemCard.js'

export interface QueueSectionProps {
  title: string
  icon?: ReactNode
  type: string
  defaultOpen?: boolean
  // Whether to expose the Snooze button (default true).
  allowSnooze?: boolean
  // Whether to render the payload preview inside the expand view.
  showPayload?: boolean
  emptyMessage?: string
}

export function QueueSection({
  title, icon, type, defaultOpen, allowSnooze = true, showPayload, emptyMessage,
}: QueueSectionProps) {
  const token = getToken()
  const toast = useToast()
  const [items, setItems] = useState<QueueItemRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  async function refresh() {
    if (!token) return
    const res = await api.ccQueue({ type, status: 'pending' }, token)
    setItems(res.items)
  }

  useEffect(() => {
    refresh().catch((e) => toast.error(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  async function setStatus(id: string, status: string, snoozeDays?: number) {
    if (!token) return
    setBusyId(id)
    try {
      const body: Record<string, unknown> = { status }
      if (snoozeDays && status === 'snoozed') {
        body.snoozedUntil = new Date(Date.now() + snoozeDays * 86_400_000).toISOString()
      }
      await api.ccUpdateQueueItem(id, body as never, token)
      await refresh()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function saveDraft(id: string) {
    if (!token) return
    setBusyId(id)
    try {
      await api.ccUpdateQueueItem(id, { draftContent: editDraft } as never, token)
      setEditingId(null)
      await refresh()
      toast.success('Draft saved')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard')
    } catch (e) {
      toast.error('Clipboard failed: ' + String(e))
    }
  }

  return (
    <Section title={title} icon={icon} count={items?.length} defaultOpen={defaultOpen}>
      {items === null && <EmptyState message="Loading…" />}
      {items && items.length === 0 && (
        <EmptyState message={emptyMessage ?? `No ${title.toLowerCase()} yet.`} />
      )}
      {items?.map((item) => (
        <div key={item.id}>
          {editingId === item.id ? (
            <div style={{ marginBottom: 8 }}>
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={8}
                style={{
                  width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 13,
                  padding: 8, background: '#1a1a17', color: '#d4e1e5',
                  border: '1px solid rgba(80,146,156,0.4)', borderRadius: 3,
                }}
              />
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <button onClick={() => saveDraft(item.id)} disabled={busyId === item.id}
                  style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  Save
                </button>
                <button onClick={() => setEditingId(null)}
                  style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <QueueItemCard
              item={item}
              showPayload={showPayload}
              actions={{
                busy: busyId === item.id,
                onEdit: () => { setEditingId(item.id); setEditDraft(item.draftContent ?? '') },
                onCopy: item.draftContent ? () => copy(item.draftContent!) : undefined,
                onOpen: item.sourceUrl ? () => window.open(item.sourceUrl!, '_blank') : undefined,
                onSend: () => setStatus(item.id, 'sent'),
                onSkip: () => setStatus(item.id, 'skipped'),
                onSnooze: allowSnooze ? () => setStatus(item.id, 'snoozed', 7) : undefined,
              }}
            />
          )}
        </div>
      ))}
    </Section>
  )
}
