import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { StyleExclusionRuleRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Header } from './DecomposerRules.js'

type Draft = Omit<StyleExclusionRuleRow, 'id'>

const EMPTY: Draft = {
  triggerField: '*', triggerValue: '', exclude: '',
  overrideField: null, overridePattern: null, note: null,
}

export function FailureRules() {
  const [rows, setRows] = useState<StyleExclusionRuleRow[]>([])
  const [editing, setEditing] = useState<Record<string, Draft>>({})
  const [adding, setAdding] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken()
    if (!token) return
    try {
      const r = await api.styleExclusionRules(token)
      setRows(r)
      setEditing({})
    } catch (e: any) {
      setErr(e.message ?? 'load failed')
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { load() }, [])

  const startEdit = (r: StyleExclusionRuleRow) => {
    const { id, ...rest } = r
    setEditing({ ...editing, [id]: rest })
  }

  const cancelEdit = (id: string) => {
    const next = { ...editing }; delete next[id]; setEditing(next)
  }

  const saveEdit = async (id: string) => {
    const token = getToken()
    const draft = editing[id]
    if (!token || !draft) return
    setBusy(id); setErr(null)
    try {
      await api.updateStyleExclusionRule(id, normalize(draft), token)
      await load()
    } catch (e: any) {
      setErr(e.message ?? 'save failed')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string) => {
    const token = getToken()
    if (!token) return
    if (!confirm('Delete this rule?')) return
    setBusy(id); setErr(null)
    try {
      await api.deleteStyleExclusionRule(id, token)
      await load()
    } catch (e: any) {
      setErr(e.message ?? 'delete failed')
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    const token = getToken()
    if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try {
      await api.createStyleExclusionRule(normalize(adding), token)
      setAdding(null)
      await load()
    } catch (e: any) {
      setErr(e.message ?? 'create failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        title="Style Exclusion Rules"
        subtitle="Sanitizer pass — substring triggers, optional override patterns; case-insensitive"
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => setAdding(adding ? null : { ...EMPTY })}
          style={{
            background: adding ? T.surfaceRaised : T.accent,
            color: adding ? T.text : T.bg,
            border: 'none', borderRadius: 4, padding: '7px 14px',
            fontFamily: T.mono, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >{adding ? 'cancel' : '+ new rule'}</button>
        <span style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono }}>
          {rows.length} rule{rows.length === 1 ? '' : 's'}
        </span>
        {err && <span style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {loaded && (
        <div style={{
          border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden',
        }}>
          <HeaderRow />
          {adding && (
            <RuleRow
              draft={adding}
              onChange={setAdding}
              onSave={create}
              onCancel={() => setAdding(null)}
              busy={busy === '__new__'}
              isNew
            />
          )}
          {rows.map((r) => {
            const draft = editing[r.id]
            return draft ? (
              <RuleRow
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
          {rows.length === 0 && !adding && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>
              no rules
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normalize(d: Draft): Draft {
  return {
    triggerField: d.triggerField.trim(),
    triggerValue: d.triggerValue,
    exclude: d.exclude.trim(),
    overrideField: d.overrideField?.trim() ? d.overrideField.trim() : null,
    overridePattern: d.overridePattern?.trim() ? d.overridePattern.trim() : null,
    note: d.note?.trim() ? d.note.trim() : null,
  }
}

const COLS = '120px 1fr 1.4fr 120px 1fr 1fr 110px'

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.mono, fontSize: 10, color: T.textDim, textTransform: 'uppercase',
    }}>
      <span>trigger field</span>
      <span>trigger value</span>
      <span>exclude</span>
      <span>override field</span>
      <span>override pattern</span>
      <span>note</span>
      <span></span>
    </div>
  )
}

function DisplayRow({ row, onEdit, onDelete, busy }: {
  row: StyleExclusionRuleRow; onEdit: () => void; onDelete: () => void; busy: boolean
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.mono, fontSize: 11, color: T.text, alignItems: 'center',
    }}>
      <span style={{ color: row.triggerField === '*' ? T.accentMuted : T.text }}>{row.triggerField}</span>
      <span style={{ color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.triggerValue}</span>
      <span style={{ color: T.danger, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.exclude}</span>
      <span style={{ color: T.textMuted }}>{row.overrideField ?? '—'}</span>
      <span style={{ color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.overridePattern ?? '—'}</span>
      <span style={{ color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.note ?? ''}</span>
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onEdit} disabled={busy} style={btn(false)}>edit</button>
        <button onClick={onDelete} disabled={busy} style={btn(true)}>×</button>
      </span>
    </div>
  )
}

function RuleRow({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: Draft; onChange: (d: Draft) => void
  onSave: () => void; onCancel: () => void; busy: boolean; isNew?: boolean
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  const valid = draft.triggerField.trim() && draft.exclude.trim()
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '8px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      background: isNew ? T.accentGlow : T.surfaceRaised, alignItems: 'center',
    }}>
      <input value={draft.triggerField} onChange={(e) => set('triggerField', e.target.value)} style={inp} placeholder="* or field" />
      <input value={draft.triggerValue} onChange={(e) => set('triggerValue', e.target.value)} style={inp} placeholder="(empty if *)" />
      <input value={draft.exclude} onChange={(e) => set('exclude', e.target.value)} style={inp} placeholder="substring" />
      <input value={draft.overrideField ?? ''} onChange={(e) => set('overrideField', e.target.value || null)} style={inp} placeholder="optional" />
      <input value={draft.overridePattern ?? ''} onChange={(e) => set('overridePattern', e.target.value || null)} style={inp} placeholder="optional" />
      <input value={draft.note ?? ''} onChange={(e) => set('note', e.target.value || null)} style={inp} placeholder="note" />
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onSave} disabled={busy || !valid} style={{
          ...btn(false),
          background: valid ? T.accent : T.surfaceRaised,
          color: valid ? T.bg : T.textDim,
          fontWeight: 600,
        }}>{busy ? '…' : 'save'}</button>
        <button onClick={onCancel} disabled={busy} style={btn(false)}>cancel</button>
      </span>
    </div>
  )
}

const inp: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 11, padding: '5px 8px', borderRadius: 3, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

const btn = (danger: boolean): CSSProperties => ({
  background: 'transparent',
  border: `1px solid ${danger ? T.danger : T.border}`,
  color: danger ? T.danger : T.textMuted,
  padding: '4px 10px', borderRadius: 3,
  fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
})
