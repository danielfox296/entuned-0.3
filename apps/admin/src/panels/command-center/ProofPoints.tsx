// Proof Points section — structured testimonials + data points.
//
// Renders all rows with their content coverage per format. "Add" lets Daniel
// drop in a new quote inline. The content-multiplier worker reads these and
// generates the missing format permutations into ContentPiece.

import { useEffect, useState } from 'react'
import { api, getToken, type ProofPointRow } from '../../api.js'
import { useToast } from '../../ui/index.js'
import { Section, EmptyState } from './Section.js'
import { T } from '@entuned/tokens'

const CATEGORIES = ['testimonial', 'data_point', 'staff_quote', 'customer_quote'] as const
const FORMATS = ['linkedin', 'reddit_comment', 'blog', 'email_snippet', 'tweet', 'video_script', 'cold_email_opener']

export function ProofPoints() {
  const token = getToken()
  const toast = useToast()
  const [items, setItems] = useState<ProofPointRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    label: '', quoteText: '', attribution: '', context: '',
    category: 'customer_quote' as (typeof CATEGORIES)[number], tags: '',
  })

  async function refresh() {
    if (!token) return
    const res = await api.ccProofPoints(token)
    setItems(res.items)
  }

  useEffect(() => {
    refresh().catch((e) => toast.error(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    if (!token) return
    try {
      await api.ccCreateProofPoint({
        label: draft.label.trim(),
        quoteText: draft.quoteText.trim(),
        attribution: draft.attribution.trim(),
        context: draft.context.trim() || null,
        category: draft.category,
        eventDate: null,
        tags: draft.tags.split(',').map((s) => s.trim()).filter(Boolean),
      } as never, token)
      setAdding(false)
      setDraft({ label: '', quoteText: '', attribution: '', context: '', category: 'customer_quote', tags: '' })
      await refresh()
      toast.success('Proof point added')
    } catch (e) {
      toast.error(String(e))
    }
  }

  async function remove(id: string) {
    if (!token) return
    if (!confirm('Delete this proof point? Linked content pieces will keep their text but lose the reference.')) return
    try {
      await api.ccDeleteProofPoint(id, token)
      await refresh()
    } catch (e) {
      toast.error(String(e))
    }
  }

  return (
    <Section title="Proof Points" count={items?.length}>
      {!adding && (
        <button onClick={() => setAdding(true)}
          style={{
            marginBottom: 12, padding: '4px 12px', fontSize: 12,
            background: T.accentGlow, color: T.accent, border: `1px solid ${T.accentMuted}`,
            borderRadius: 3, cursor: 'pointer',
          }}>+ Add proof point</button>
      )}
      {adding && (
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          padding: 12, borderRadius: 4, marginBottom: 12,
        }}>
          <Row label="Label">
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="kari-conversion-lift" style={inputStyle} />
          </Row>
          <Row label="Quote">
            <textarea value={draft.quoteText} onChange={(e) => setDraft({ ...draft, quoteText: e.target.value })}
              rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
          </Row>
          <Row label="Attribution">
            <input value={draft.attribution} onChange={(e) => setDraft({ ...draft, attribution: e.target.value })}
              placeholder="Kari S., Assistant Manager" style={inputStyle} />
          </Row>
          <Row label="Context">
            <textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })}
              rows={2} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
          </Row>
          <Row label="Category">
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as never })}
              style={inputStyle}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Row>
          <Row label="Tags">
            <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="conversion, pilot, semantic-priming" style={inputStyle} />
          </Row>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button onClick={save} style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer', background: T.accentGlow, color: T.accent, border: `1px solid ${T.accentMuted}`, borderRadius: 3 }}>Save</button>
            <button onClick={() => setAdding(false)} style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {items === null && <EmptyState message="Loading…" />}
      {items && items.length === 0 && (
        <EmptyState message="No proof points yet — add testimonials, data points, customer quotes here." />
      )}

      {items?.map((p) => {
        const haveFormats = new Set((p.pieces ?? []).map((x) => x.format))
        return (
          <div key={p.id} style={{
            border: `1px solid ${T.border}`, borderRadius: 4,
            padding: 12, marginBottom: 8, background: T.surface,
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{
                fontSize: 11, color: T.gold, fontFamily: T.mono,
                background: 'rgba(215, 175, 116, 0.15)', padding: '1px 6px', borderRadius: 3,
              }}>{p.category}</span>
              <span style={{ fontSize: 13, color: T.text, fontFamily: T.mono }}>{p.label}</span>
              <button onClick={() => remove(p.id)}
                style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11, color: T.danger, background: 'transparent', border: `1px solid ${T.borderSubtle}`, borderRadius: 3, cursor: 'pointer' }}>Delete</button>
            </div>
            <div style={{ fontSize: 13, color: T.textMuted, fontStyle: 'italic', marginBottom: 6 }}>
              "{p.quoteText}"
            </div>
            <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6 }}>— {p.attribution}</div>
            {p.context && (
              <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 6 }}>{p.context}</div>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
              {FORMATS.map((f) => (
                <span key={f} style={{
                  fontSize: 10, fontFamily: T.mono,
                  color: haveFormats.has(f) ? T.success : T.textFaint,
                  background: haveFormats.has(f) ? 'rgba(82, 196, 122, 0.1)' : 'transparent',
                  padding: '1px 5px', borderRadius: 2,
                  border: `1px solid ${haveFormats.has(f) ? 'rgba(82, 196, 122, 0.3)' : T.borderSubtle}`,
                }}>{f}</span>
              ))}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

const inputStyle: React.CSSProperties = {
  fontSize: 13, fontFamily: 'Inter, sans-serif',
  padding: '4px 8px', background: '#1a1a17', color: '#d4e1e5',
  border: '1px solid rgba(80,146,156,0.4)', borderRadius: 3, minWidth: 280,
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, alignItems: 'flex-start' }}>
      <div style={{ width: 100, fontSize: 12, color: T.textDim, paddingTop: 4 }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
