// GenreGravityRules — counter-exclusion table consumed by Music Professor
// module 2. Each row: a genre tag, a 1–10 gravity score, and a list of
// terms to inject into negativeStyle when that tag appears in Mars's
// positive style. Operator seeds the table from real Suno drift
// observations ("soft rock pulled to smooth jazz again — add adult
// contemporary, easy listening to its counter-exclusions").

import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { GenreGravityRuleRow, GenreGravityRuleDraft } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, PanelHeader, S } from '../../ui/index.js'

type Editing = GenreGravityRuleDraft & { id?: string; _exclusionsText?: string }

const EMPTY: Editing = { tag: '', gravity: 5, counterExclusions: [], notes: '', active: true, _exclusionsText: '' }

function fromRow(r: GenreGravityRuleRow): Editing {
  return {
    tag: r.tag,
    gravity: r.gravity,
    counterExclusions: r.counterExclusions,
    notes: r.notes ?? '',
    active: r.active,
    _exclusionsText: r.counterExclusions.join(', '),
  }
}

function normalize(d: Editing): GenreGravityRuleDraft {
  const fromText = (d._exclusionsText ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    tag: d.tag.trim(),
    gravity: d.gravity ?? 5,
    counterExclusions: fromText,
    notes: d.notes?.trim() ? d.notes.trim() : null,
    active: d.active ?? true,
  }
}

export function GenreGravityRules() {
  const [rows, setRows] = useState<GenreGravityRuleRow[]>([])
  const [editing, setEditing] = useState<Record<string, Editing>>({})
  const [adding, setAdding] = useState<Editing | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.genreGravityRules(token)
      setRows(r); setEditing({})
    } catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
  }

  useEffect(() => { load() }, [])

  const startEdit = (r: GenreGravityRuleRow) => setEditing({ ...editing, [r.id]: fromRow(r) })
  const cancelEdit = (id: string) => {
    const next = { ...editing }; delete next[id]; setEditing(next)
  }
  const saveEdit = async (id: string) => {
    const token = getToken(); const draft = editing[id]
    if (!token || !draft) return
    setBusy(id); setErr(null)
    try {
      await api.updateGenreGravityRule(id, normalize(draft), token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(null) }
  }
  const remove = async (id: string) => {
    const token = getToken(); if (!token) return
    setBusy(id); setErr(null)
    try {
      await api.deleteGenreGravityRule(id, token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'delete failed') }
    finally { setBusy(null) }
  }
  const toggleActive = async (r: GenreGravityRuleRow) => {
    const token = getToken(); if (!token) return
    setBusy(r.id); setErr(null)
    try {
      await api.updateGenreGravityRule(r.id, { active: !r.active }, token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'toggle failed') }
    finally { setBusy(null) }
  }
  const create = async () => {
    const token = getToken(); if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try {
      await api.createGenreGravityRule(normalize(adding), token)
      setAdding(null); await load()
    } catch (e: any) { setErr(e.message ?? 'create failed') }
    finally { setBusy(null) }
  }

  const activeCount = rows.filter((r) => r.active).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader
        title="Genre Gravity Rules"
        subtitle={`Counter-exclusion table for Music Professor module 2. Each rule: when this genre tag appears in Mars output, inject these terms into negativeStyle to push off Suno's centroid. ${activeCount}/${rows.length} active. Empty until you seed from observed drift.`}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button
          variant={adding ? 'ghost' : 'primary'}
          onClick={() => setAdding(adding ? null : { ...EMPTY })}
        >{adding ? 'cancel' : '+ new rule'}</Button>
        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {loaded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
          {adding && (
            <RuleCard
              draft={adding}
              onChange={setAdding as (d: Editing) => void}
              onSave={create}
              onCancel={() => setAdding(null)}
              busy={busy === '__new__'}
              isNew
            />
          )}
          {rows.map((r) => {
            const draft = editing[r.id]
            return draft ? (
              <RuleCard
                key={r.id}
                draft={draft}
                onChange={(d) => setEditing({ ...editing, [r.id]: d })}
                onSave={() => saveEdit(r.id)}
                onCancel={() => cancelEdit(r.id)}
                busy={busy === r.id}
              />
            ) : (
              <DisplayCard
                key={r.id}
                row={r}
                onEdit={() => startEdit(r)}
                onDelete={() => remove(r.id)}
                onToggleActive={() => toggleActive(r)}
                busy={busy === r.id}
              />
            )
          })}
          {rows.length === 0 && !adding && (
            <div style={{
              padding: 24, textAlign: 'center', color: T.textDim,
              fontFamily: T.sans, fontSize: S.small,
              border: `1px dashed ${T.border}`, borderRadius: S.r4,
            }}>
              no rules yet — module 2 is a no-op until you populate this table from observed Suno drift
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DisplayCard({ row, onEdit, onDelete, onToggleActive, busy }: {
  row: GenreGravityRuleRow
  onEdit: () => void; onDelete: () => void; onToggleActive: () => void; busy: boolean
}) {
  return (
    <div style={{
      border: `1px solid ${row.active ? T.border : T.borderSubtle}`,
      borderRadius: S.r4, padding: 16, background: T.surface,
      opacity: row.active ? 1 : 0.55,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{
            fontFamily: T.mono, fontSize: S.label, color: T.textDim, minWidth: 36,
          }}>g{row.gravity}</span>
          <span style={{ fontFamily: T.sans, fontSize: S.subhead, color: T.text, fontWeight: 600 }}>
            {row.tag}
          </span>
          {!row.active && (
            <span style={{
              fontFamily: T.sans, fontSize: S.label, color: T.textDim,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>inactive</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="tiny" onClick={onToggleActive} disabled={busy}>
            {row.active ? 'deactivate' : 'activate'}
          </Button>
          <Button variant="tiny" onClick={onEdit} disabled={busy}>edit</Button>
          <Button variant="tinyDanger" onClick={onDelete} disabled={busy}>×</Button>
        </div>
      </div>
      <div style={{
        fontFamily: T.mono, fontSize: S.small, color: T.textMuted, lineHeight: 1.5,
      }}>
        → {row.counterExclusions.length > 0 ? row.counterExclusions.join(', ') : <em style={{ color: T.textDim }}>(no exclusions configured)</em>}
      </div>
      {row.notes && (
        <div style={{
          fontFamily: T.sans, fontSize: S.small, color: T.textDim, lineHeight: 1.5,
          fontStyle: 'italic',
        }}>{row.notes}</div>
      )}
    </div>
  )
}

function RuleCard({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: Editing; onChange: (d: Editing) => void
  onSave: () => void; onCancel: () => void; busy: boolean; isNew?: boolean
}) {
  const set = <K extends keyof Editing>(k: K, v: Editing[K]) => onChange({ ...draft, [k]: v })
  const valid = draft.tag.trim().length > 0 && (draft._exclusionsText ?? '').trim().length > 0
  return (
    <div style={{
      border: `1px solid ${T.accentMuted}`, borderRadius: S.r4, padding: 16,
      background: isNew ? T.accentGlow : T.surfaceRaised,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input
          value={draft.tag}
          onChange={(e) => set('tag', e.target.value)}
          placeholder='tag (e.g. "soft rock")'
          style={{ flex: 1, minWidth: 180 }}
        />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: T.sans, fontSize: S.small, color: T.textMuted,
        }}>
          gravity
          <Input
            type="number"
            min={1}
            max={10}
            value={String(draft.gravity ?? 5)}
            onChange={(e) => set('gravity', Number(e.target.value) || 5)}
            style={{ width: 60 }}
          />
        </label>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: T.sans, fontSize: S.small, color: T.textMuted, whiteSpace: 'nowrap',
        }}>
          <input
            type="checkbox"
            checked={draft.active ?? true}
            onChange={(e) => set('active', e.target.checked)}
          />
          active
        </label>
      </div>
      <textarea
        value={draft._exclusionsText ?? ''}
        onChange={(e) => set('_exclusionsText', e.target.value)}
        placeholder="counter-exclusions, comma-separated (e.g. smooth jazz, adult contemporary, easy listening)"
        rows={3}
        style={{
          fontFamily: T.mono, fontSize: S.small, color: T.text,
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4,
          padding: 10, resize: 'vertical', lineHeight: 1.5,
        }}
      />
      <textarea
        value={draft.notes ?? ''}
        onChange={(e) => set('notes', e.target.value)}
        placeholder="notes (optional) — what drift pattern triggered this rule?"
        rows={2}
        style={{
          fontFamily: T.sans, fontSize: S.small, color: T.text,
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4,
          padding: 10, resize: 'vertical', lineHeight: 1.5,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <Button variant="tiny" onClick={onCancel} disabled={busy}>cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={!valid} busy={busy}>
          {busy ? '…' : 'save'}
        </Button>
      </div>
    </div>
  )
}
