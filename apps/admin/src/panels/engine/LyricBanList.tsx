import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { LyricBanEntryRow, LyricBanCategory } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, Select, PanelHeader, S } from '../../ui/index.js'

type Draft = Omit<LyricBanEntryRow, 'id'>

const EMPTY: Draft = { category: 'overused_word', text: '', note: null }

const CATEGORY_LABELS: Record<LyricBanCategory, string> = {
  overused_word: 'Overused Word',
  cliche_phrase: 'Cliché Phrase',
  cliche_shape: 'Cliché Shape',
}

const CATEGORY_OPTIONS: { value: LyricBanCategory; label: string }[] = [
  { value: 'overused_word', label: 'Overused Word' },
  { value: 'cliche_phrase', label: 'Cliché Phrase' },
  { value: 'cliche_shape', label: 'Cliché Shape' },
]

export function LyricBanList() {
  const [rows, setRows] = useState<LyricBanEntryRow[]>([])
  const [editing, setEditing] = useState<Record<string, Draft>>({})
  const [adding, setAdding] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState<LyricBanCategory | 'all'>('all')

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.lyricBanEntries(token)
      setRows(r); setEditing({})
    } catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
  }

  useEffect(() => { load() }, [])

  const startEdit = (r: LyricBanEntryRow) => {
    const { id, ...rest } = r
    setEditing({ ...editing, [id]: rest })
  }

  const cancelEdit = (id: string) => {
    const next = { ...editing }; delete next[id]; setEditing(next)
  }

  const saveEdit = async (id: string) => {
    const token = getToken(); const draft = editing[id]
    if (!token || !draft) return
    setBusy(id); setErr(null)
    try {
      await api.updateLyricBanEntry(id, normalize(draft), token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    const token = getToken(); if (!token) return
    setBusy(id); setErr(null)
    try {
      await api.deleteLyricBanEntry(id, token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'delete failed') }
    finally { setBusy(null) }
  }

  const create = async () => {
    const token = getToken(); if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try {
      await api.createLyricBanEntry(normalize(adding), token)
      setAdding(null); await load()
    } catch (e: any) { setErr(e.message ?? 'create failed') }
    finally { setBusy(null) }
  }

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.category === filter)
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader
        title="Lyric Ban List"
        subtitle="Overused words, cliché phrases, and cliché shapes — fed into the lyric edit pass and hook drafter"
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button
          variant={adding ? 'ghost' : 'primary'}
          onClick={() => setAdding(adding ? null : { ...EMPTY })}
        >{adding ? 'cancel' : '+ new entry'}</Button>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'overused_word', 'cliche_phrase', 'cliche_shape'] as const).map((cat) => (
            <button key={cat} onClick={() => setFilter(cat)} style={{
              background: filter === cat ? T.accent : T.surfaceRaised,
              color: filter === cat ? T.bg : T.textMuted,
              border: `1px solid ${filter === cat ? T.accent : T.border}`,
              borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
              fontFamily: T.sans, fontSize: S.label, fontWeight: filter === cat ? 600 : 400,
            }}>
              {cat === 'all' ? `All (${rows.length})` : `${CATEGORY_LABELS[cat]} (${counts[cat] ?? 0})`}
            </button>
          ))}
        </div>

        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {loaded && (
        <div style={{
          border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden',
        }}>
          <HeaderRow />
          {adding && (
            <EntryRow
              draft={adding}
              onChange={setAdding}
              onSave={create}
              onCancel={() => setAdding(null)}
              busy={busy === '__new__'}
              isNew
            />
          )}
          {filtered.map((r) => {
            const draft = editing[r.id]
            return draft ? (
              <EntryRow
                key={r.id}
                draft={draft}
                onChange={(d) => setEditing({ ...editing, [r.id]: d! })}
                onSave={() => saveEdit(r.id)}
                onCancel={() => cancelEdit(r.id)}
                busy={busy === r.id}
              />
            ) : (
              <DisplayRow
                key={r.id}
                row={r}
                onEdit={() => startEdit(r)}
                onDelete={() => remove(r.id)}
                busy={busy === r.id}
              />
            )
          })}
          {filtered.length === 0 && !adding && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
              {filter === 'all' ? 'no entries' : `no ${CATEGORY_LABELS[filter as LyricBanCategory].toLowerCase()} entries`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normalize(d: Draft): Draft {
  return {
    category: d.category,
    text: d.text.trim(),
    note: d.note?.trim() ? d.note.trim() : null,
  }
}

const COLS = '160px 1fr 1fr 110px'

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.sans, fontSize: S.label, color: T.textDim, textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      <span>category</span>
      <span>text</span>
      <span>note</span>
      <span></span>
    </div>
  )
}

function DisplayRow({ row, onEdit, onDelete, busy }: {
  row: LyricBanEntryRow; onEdit: () => void; onDelete: () => void; busy: boolean
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.sans, fontSize: S.small, color: T.text, alignItems: 'center',
    }}>
      <span style={{
        color: T.accentMuted, fontSize: S.label, textTransform: 'uppercase', letterSpacing: '0.03em',
      }}>{CATEGORY_LABELS[row.category]}</span>
      <span title={row.text} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.text}</span>
      <span title={row.note ?? ''} style={{ color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.note ?? ''}</span>
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button variant="tiny" onClick={onEdit} disabled={busy}>edit</Button>
        <Button variant="tinyDanger" onClick={onDelete} disabled={busy}>×</Button>
      </span>
    </div>
  )
}

function EntryRow({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: Draft; onChange: (d: Draft) => void
  onSave: () => void; onCancel: () => void; busy: boolean; isNew?: boolean
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  const valid = !!(draft.text.trim())
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '8px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      background: isNew ? T.accentGlow : T.surfaceRaised, alignItems: 'center',
    }}>
      <Select value={draft.category} onChange={(e) => set('category', e.target.value as LyricBanCategory)}>
        {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <Input value={draft.text} onChange={(e) => set('text', e.target.value)} placeholder="word or phrase" />
      <Input value={draft.note ?? ''} onChange={(e) => set('note', e.target.value || null)} placeholder="note (optional)" />
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={onSave} disabled={!valid} busy={busy}>
          {busy ? '…' : 'save'}
        </Button>
        <Button variant="tiny" onClick={onCancel} disabled={busy}>cancel</Button>
      </span>
    </div>
  )
}
