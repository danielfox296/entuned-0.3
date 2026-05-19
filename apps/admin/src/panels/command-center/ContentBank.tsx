// Content Bank section.
//
// Lists content pieces with filters by narrative/format/status. Each piece
// can be edited inline, status-toggled (draft → approved → published), and
// copied to clipboard. The content multiplier worker writes drafts here;
// Daniel reviews and approves from this view.

import { useEffect, useState } from 'react'
import { api, getToken, type ContentPieceRow } from '../../api.js'
import { useToast } from '../../ui/index.js'
import { Section, EmptyState } from './Section.js'
import { T } from '@entuned/tokens'

const FORMATS = [
  'linkedin', 'reddit_comment', 'blog', 'email_snippet',
  'tweet', 'video_script', 'cold_email_opener',
]
const STATUSES = ['draft', 'approved', 'published', 'rejected']

export function ContentBank() {
  const token = getToken()
  const toast = useToast()
  const [items, setItems] = useState<ContentPieceRow[] | null>(null)
  const [filterFormat, setFilterFormat] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('draft')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function refresh() {
    if (!token) return
    const res = await api.ccContent({
      format: filterFormat || undefined,
      status: filterStatus || undefined,
    }, token)
    setItems(res.items)
  }

  useEffect(() => {
    refresh().catch((e) => toast.error(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFormat, filterStatus])

  async function setStatus(id: string, status: string) {
    if (!token) return
    setBusyId(id)
    try {
      await api.ccUpdateContent(id, { status } as never, token)
      await refresh()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function saveBody(id: string) {
    if (!token) return
    setBusyId(id)
    try {
      await api.ccUpdateContent(id, { body: editBody } as never, token)
      setEditingId(null)
      await refresh()
      toast.success('Saved')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch (e) {
      toast.error('Clipboard failed: ' + String(e))
    }
  }

  return (
    <Section title="Content Bank" count={items?.length}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: T.textDim }}>Format:</label>
        <select value={filterFormat} onChange={(e) => setFilterFormat(e.target.value)}
          style={{ fontSize: 12, padding: '2px 8px', background: T.surface, color: T.text, border: `1px solid ${T.border}` }}>
          <option value="">all</option>
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <label style={{ fontSize: 12, color: T.textDim, marginLeft: 12 }}>Status:</label>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          style={{ fontSize: 12, padding: '2px 8px', background: T.surface, color: T.text, border: `1px solid ${T.border}` }}>
          <option value="">all</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {items === null && <EmptyState message="Loading…" />}
      {items && items.length === 0 && (
        <EmptyState message="No content pieces match these filters. Workers will populate this once they run." />
      )}

      {items?.map((c) => (
        <div key={c.id} style={{
          border: `1px solid ${T.border}`, borderRadius: 4,
          padding: 12, marginBottom: 8, background: T.surface,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{
              fontSize: 11, color: T.accent, fontFamily: T.mono,
              background: T.accentGlow, padding: '1px 6px', borderRadius: 3,
            }}>{c.format}</span>
            <span style={{ fontSize: 12, color: T.textDim }}>{c.narrative}</span>
            <span style={{
              fontSize: 11, fontFamily: T.mono,
              color: c.status === 'published' ? T.success : c.status === 'approved' ? T.gold : T.textFaint,
              marginLeft: 'auto',
            }}>{c.status}</span>
          </div>
          {c.title && (
            <div style={{ fontSize: 14, color: T.text, fontFamily: T.sans, fontWeight: 500, marginBottom: 6 }}>
              {c.title}
            </div>
          )}
          {editingId === c.id ? (
            <>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={Math.min(20, Math.max(4, Math.ceil(editBody.length / 80)))}
                style={{
                  width: '100%', fontFamily: 'Inter, sans-serif', fontSize: 13,
                  padding: 8, background: T.inkDeep, color: T.text,
                  border: `1px solid ${T.borderActive}`, borderRadius: 3,
                }}
              />
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <button onClick={() => saveBody(c.id)} disabled={busyId === c.id}
                  style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setEditingId(null)}
                  style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </div>
            </>
          ) : (
            <div style={{
              fontSize: 13, color: T.textMuted, whiteSpace: 'pre-wrap',
              background: T.inkDeep, border: `1px solid ${T.borderSubtle}`,
              padding: 10, borderRadius: 3, maxHeight: 200, overflow: 'auto',
            }}>{c.body}</div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => { setEditingId(c.id); setEditBody(c.body) }}
              style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer', background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 3 }}>Edit</button>
            <button onClick={() => copy(c.body)}
              style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer', background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 3 }}>Copy</button>
            {c.status === 'draft' && (
              <button onClick={() => setStatus(c.id, 'approved')} disabled={busyId === c.id}
                style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer', background: T.accentGlow, color: T.accent, border: `1px solid ${T.accentMuted}`, borderRadius: 3 }}>Approve</button>
            )}
            {c.status === 'approved' && (
              <button onClick={() => setStatus(c.id, 'published')} disabled={busyId === c.id}
                style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer', background: T.accentGlow, color: T.accent, border: `1px solid ${T.accentMuted}`, borderRadius: 3 }}>Mark Published</button>
            )}
            <button onClick={() => setStatus(c.id, 'rejected')} disabled={busyId === c.id}
              style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: T.textDim, background: 'transparent', border: `1px solid ${T.borderSubtle}`, borderRadius: 3 }}>Reject</button>
          </div>
        </div>
      ))}
    </Section>
  )
}
