import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { StyleExclusionRuleRow } from '../../api.js'
import { T } from '../../tokens.js'
import { Button, Input, PanelHeader, S } from '../../ui/index.js'

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
    const token = getToken(); if (!token) return
    try {
      const r = await api.styleExclusionRules(token)
      setRows(r); setEditing({})
    } catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
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
    const token = getToken(); const draft = editing[id]
    if (!token || !draft) return
    setBusy(id); setErr(null)
    try {
      await api.updateStyleExclusionRule(id, normalize(draft), token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    const token = getToken(); if (!token) return
    setBusy(id); setErr(null)
    try {
      await api.deleteStyleExclusionRule(id, token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'delete failed') }
    finally { setBusy(null) }
  }

  const create = async () => {
    const token = getToken(); if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try {
      await api.createStyleExclusionRule(normalize(adding), token)
      setAdding(null); await load()
    } catch (e: any) { setErr(e.message ?? 'create failed') }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader
        title="Style Exclusion Rules"
        subtitle="Sanitizer pass — substring triggers, optional override patterns; case-insensitive"
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          variant={adding ? 'ghost' : 'primary'}
          onClick={() => setAdding(adding ? null : { ...EMPTY })}
        >{adding ? 'cancel' : '+ new rule'}</Button>
        <span style={{ fontSize: S.small, color: T.textDim, fontFamily: T.sans }}>
          {rows.length} rule{rows.length === 1 ? '' : 's'}
        </span>
        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {loaded && (
        <div style={{
          border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden',
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
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
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

const COLS = '180px 1fr 1.4fr 140px 1fr 1fr 110px'

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.sans, fontSize: S.label, color: T.textDim, textTransform: 'uppercase',
      letterSpacing: '0.04em',
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
      fontFamily: T.sans, fontSize: S.small, color: T.text, alignItems: 'center',
    }}>
      <span title={row.triggerField} style={{ color: row.triggerField === '*' ? T.accentMuted : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.triggerField}</span>
      <span title={row.triggerValue ?? ''} style={{ color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.triggerValue}</span>
      <span title={row.exclude} style={{ color: T.danger, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.exclude}</span>
      <span style={{ color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.overrideField ?? '—'}</span>
      <span title={row.overridePattern ?? ''} style={{ color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.overridePattern ?? '—'}</span>
      <span title={row.note ?? ''} style={{ color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.note ?? ''}</span>
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button variant="tiny" onClick={onEdit} disabled={busy}>edit</Button>
        <Button variant="tinyDanger" onClick={onDelete} disabled={busy}>×</Button>
      </span>
    </div>
  )
}

function RuleRow({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: Draft; onChange: (d: Draft) => void
  onSave: () => void; onCancel: () => void; busy: boolean; isNew?: boolean
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  const valid = !!(draft.triggerField.trim() && draft.exclude.trim())
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 8,
      padding: '8px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      background: isNew ? T.accentGlow : T.surfaceRaised, alignItems: 'center',
    }}>
      <Input value={draft.triggerField} onChange={(e) => set('triggerField', e.target.value)} placeholder="* or field" />
      <Input value={draft.triggerValue} onChange={(e) => set('triggerValue', e.target.value)} placeholder="(empty if *)" />
      <Input value={draft.exclude} onChange={(e) => set('exclude', e.target.value)} placeholder="substring" />
      <Input value={draft.overrideField ?? ''} onChange={(e) => set('overrideField', e.target.value || null)} placeholder="optional" />
      <Input value={draft.overridePattern ?? ''} onChange={(e) => set('overridePattern', e.target.value || null)} placeholder="optional" />
      <Input value={draft.note ?? ''} onChange={(e) => set('note', e.target.value || null)} placeholder="note" />
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={onSave} disabled={!valid} busy={busy}>
          {busy ? '…' : 'save'}
        </Button>
        <Button variant="tiny" onClick={onCancel} disabled={busy}>cancel</Button>
      </span>
    </div>
  )
}
