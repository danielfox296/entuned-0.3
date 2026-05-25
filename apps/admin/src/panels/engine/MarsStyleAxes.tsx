import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type {
  MarsContaminationTermRow, MarsContaminationCategory,
  MarsAxisRuleRow, MarsAxisType,
} from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, Select, PanelHeader, S } from '../../ui/index.js'

const CONTAM_CATEGORIES: { value: MarsContaminationCategory; label: string }[] = [
  { value: 'always_fire', label: 'Always-fire (Suno mis-triggers)' },
  { value: 'modern_drift', label: 'Modern-drift (suppressed on modern tracks)' },
  { value: 'modern_family', label: 'Modern-family (suppression trigger)' },
]

const AXIS_TYPES: { value: MarsAxisType; label: string }[] = [
  { value: 'genre', label: 'Genre' },
  { value: 'vocal', label: 'Vocal' },
  { value: 'mood', label: 'Mood' },
  { value: 'production', label: 'Production' },
]

export function MarsStyleAxes() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader
        title="Mars Style Axes"
        subtitle="Negative-style steering for Suno: contamination terms (always-fire / modern-drift / modern-family) and per-axis opposite-style rules (genre / vocal / mood / production)."
      />
      <ContaminationSection />
      <AxisSection />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Contamination Terms
// ─────────────────────────────────────────────────────────────────────

type ContamDraft = Omit<MarsContaminationTermRow, 'id' | 'updatedAt'>

const EMPTY_CONTAM: ContamDraft = {
  category: 'always_fire', term: '', sortOrder: 0, isActive: true, notes: null,
}

function ContaminationSection() {
  const [rows, setRows] = useState<MarsContaminationTermRow[]>([])
  const [editing, setEditing] = useState<Record<string, ContamDraft>>({})
  const [adding, setAdding] = useState<ContamDraft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<MarsContaminationCategory | 'all'>('all')
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try { setRows(await api.marsContaminationTerms(token)); setEditing({}) }
    catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
  }
  useEffect(() => { load() }, [])

  const saveEdit = async (id: string) => {
    const token = getToken(); const draft = editing[id]
    if (!token || !draft) return
    setBusy(id); setErr(null)
    try { await api.updateMarsContaminationTerm(id, draft, token); await load() }
    catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(null) }
  }
  const create = async () => {
    const token = getToken(); if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try { await api.createMarsContaminationTerm(adding, token); setAdding(null); await load() }
    catch (e: any) { setErr(e.message ?? 'create failed') }
    finally { setBusy(null) }
  }
  const remove = async (id: string) => {
    const token = getToken(); if (!token) return
    setBusy(id); setErr(null)
    try { await api.deleteMarsContaminationTerm(id, token); await load() }
    catch (e: any) { setErr(e.message ?? 'delete failed') }
    finally { setBusy(null) }
  }

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.category === filter)
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionTitle>Contamination Terms</SectionTitle>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding(adding ? null : { ...EMPTY_CONTAM })}>
          {adding ? 'cancel' : '+ new term'}
        </Button>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', ...CONTAM_CATEGORIES.map((c) => c.value)] as const).map((cat) => (
            <button key={cat} onClick={() => setFilter(cat as any)} style={chipStyle(filter === cat)}>
              {cat === 'all' ? `All (${rows.length})` : `${CONTAM_CATEGORIES.find((c) => c.value === cat)?.label} (${counts[cat] ?? 0})`}
            </button>
          ))}
        </div>
        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {loaded && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, overflow: 'hidden' }}>
          <ContamHeaderRow />
          {adding && (
            <ContamEditRow draft={adding} onChange={setAdding} onSave={create} onCancel={() => setAdding(null)} busy={busy === '__new__'} isNew />
          )}
          {filtered.map((r) => {
            const draft = editing[r.id]
            return draft ? (
              <ContamEditRow key={r.id} draft={draft} onChange={(d) => setEditing({ ...editing, [r.id]: d })}
                onSave={() => saveEdit(r.id)} onCancel={() => { const n = { ...editing }; delete n[r.id]; setEditing(n) }} busy={busy === r.id} />
            ) : (
              <ContamDisplayRow key={r.id} row={r}
                onEdit={() => { const { id: _i, updatedAt: _u, ...rest } = r; setEditing({ ...editing, [r.id]: rest }) }}
                onDelete={() => remove(r.id)} busy={busy === r.id} />
            )
          })}
          {filtered.length === 0 && !adding && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>no terms</div>
          )}
        </div>
      )}
    </div>
  )
}

const CONTAM_COLS = '200px 1fr 60px 60px 120px'

function ContamHeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: CONTAM_COLS, gap: 8, padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`, fontFamily: T.sans, fontSize: S.label, color: T.textDim,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      <span>category</span><span>term</span><span>sort</span><span>active</span><span></span>
    </div>
  )
}

function ContamDisplayRow({ row, onEdit, onDelete, busy }: {
  row: MarsContaminationTermRow; onEdit: () => void; onDelete: () => void; busy: boolean
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: CONTAM_COLS, gap: 8, padding: '10px 12px',
      borderBottom: `1px solid ${T.borderSubtle}`, fontFamily: T.sans, fontSize: S.small,
      color: T.text, alignItems: 'center',
    }}>
      <span style={{ color: T.accentMuted, fontSize: S.label, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {CONTAM_CATEGORIES.find((c) => c.value === row.category)?.label ?? row.category}
      </span>
      <span title={row.term} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.term}</span>
      <span style={{ color: T.textDim }}>{row.sortOrder}</span>
      <span style={{ color: row.isActive ? T.accent : T.textDim }}>{row.isActive ? 'yes' : 'no'}</span>
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button variant="tiny" onClick={onEdit} disabled={busy}>edit</Button>
        <Button variant="tinyDanger" onClick={onDelete} disabled={busy}>×</Button>
      </span>
    </div>
  )
}

function ContamEditRow({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: ContamDraft; onChange: (d: ContamDraft) => void
  onSave: () => void; onCancel: () => void; busy: boolean; isNew?: boolean
}) {
  const set = <K extends keyof ContamDraft>(k: K, v: ContamDraft[K]) => onChange({ ...draft, [k]: v })
  const valid = !!draft.term.trim()
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: CONTAM_COLS, gap: 8, padding: '8px 12px',
      borderBottom: `1px solid ${T.borderSubtle}`, background: isNew ? T.accentGlow : T.surfaceRaised, alignItems: 'center',
    }}>
      <Select value={draft.category} onChange={(e) => set('category', e.target.value as MarsContaminationCategory)}>
        {CONTAM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </Select>
      <Input value={draft.term} onChange={(e) => set('term', e.target.value)} placeholder="term" />
      <Input type="number" value={String(draft.sortOrder)} onChange={(e) => set('sortOrder', Number(e.target.value) || 0)} />
      <input type="checkbox" checked={draft.isActive} onChange={(e) => set('isActive', e.target.checked)} style={{ justifySelf: 'center' }} />
      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={onSave} disabled={!valid} busy={busy}>{busy ? '…' : 'save'}</Button>
        <Button variant="tiny" onClick={onCancel} disabled={busy}>cancel</Button>
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Axis Rules
// ─────────────────────────────────────────────────────────────────────

type AxisDraft = Omit<MarsAxisRuleRow, 'id' | 'updatedAt'>

const EMPTY_AXIS: AxisDraft = {
  axisType: 'genre', label: '', matchTerms: [], opposites: [], secondaryOpposites: [],
  sortOrder: 0, isActive: true, notes: null,
}

function AxisSection() {
  const [rows, setRows] = useState<MarsAxisRuleRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState<AxisDraft | null>(null)
  const [adding, setAdding] = useState<AxisDraft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<MarsAxisType | 'all'>('all')
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try { setRows(await api.marsAxisRules(token)) }
    catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
  }
  useEffect(() => { load() }, [])

  const startEdit = (r: MarsAxisRuleRow) => {
    const { id: _i, updatedAt: _u, ...rest } = r
    setExpanded(r.id); setDraft(rest); setErr(null)
  }
  const cancelEdit = () => { setExpanded(null); setDraft(null) }
  const saveEdit = async () => {
    const token = getToken(); if (!token || !expanded || !draft) return
    setBusy(expanded); setErr(null)
    try { await api.updateMarsAxisRule(expanded, draft, token); cancelEdit(); await load() }
    catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(null) }
  }
  const remove = async (id: string, label: string) => {
    if (!confirm(`Delete axis rule "${label}"?`)) return
    const token = getToken(); if (!token) return
    setBusy(id); setErr(null)
    try { await api.deleteMarsAxisRule(id, token); if (expanded === id) cancelEdit(); await load() }
    catch (e: any) { setErr(e.message ?? 'delete failed') }
    finally { setBusy(null) }
  }
  const create = async () => {
    const token = getToken(); if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try { await api.createMarsAxisRule(adding, token); setAdding(null); await load() }
    catch (e: any) { setErr(e.message ?? 'create failed') }
    finally { setBusy(null) }
  }

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.axisType === filter)
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.axisType] = (counts[r.axisType] ?? 0) + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionTitle>Axis Rules</SectionTitle>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding(adding ? null : { ...EMPTY_AXIS })}>
          {adding ? 'cancel' : '+ new rule'}
        </Button>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', ...AXIS_TYPES.map((a) => a.value)] as const).map((ax) => (
            <button key={ax} onClick={() => setFilter(ax as any)} style={chipStyle(filter === ax)}>
              {ax === 'all' ? `All (${rows.length})` : `${AXIS_TYPES.find((a) => a.value === ax)?.label} (${counts[ax] ?? 0})`}
            </button>
          ))}
        </div>
        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {adding && (
        <div style={{ padding: 14, background: T.accentGlow, border: `1px solid ${T.accent}`, borderRadius: S.r4 }}>
          <AxisEditor draft={adding} onChange={setAdding} onSave={create} onCancel={() => setAdding(null)} busy={busy === '__new__'} />
        </div>
      )}

      {loaded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((r) => (
            <div key={r.id} style={{ border: `1px solid ${T.border}`, borderRadius: S.r4, background: T.surface }}>
              <div onClick={() => expanded === r.id ? cancelEdit() : startEdit(r)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer',
              }}>
                <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.accentMuted, textTransform: 'uppercase', letterSpacing: '0.03em', minWidth: 90 }}>{r.axisType}</span>
                <span style={{ fontFamily: T.sans, fontSize: S.body, color: T.text, fontWeight: 600, flex: 1 }}>{r.label}</span>
                <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>
                  {r.matchTerms.length} match · {r.opposites.length} opp{r.secondaryOpposites.length > 0 ? ` · ${r.secondaryOpposites.length} sec` : ''}
                </span>
                {!r.isActive && (
                  <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim, padding: '2px 6px', border: `1px solid ${T.border}`, borderRadius: 3 }}>inactive</span>
                )}
                <Button variant="tinyDanger" onClick={(e: any) => { e.stopPropagation(); remove(r.id, r.label) }} disabled={busy === r.id}>×</Button>
              </div>
              {expanded === r.id && draft && (
                <div style={{ padding: 14, background: T.surfaceRaised, borderTop: `1px solid ${T.borderSubtle}` }}>
                  <AxisEditor draft={draft} onChange={setDraft} onSave={saveEdit} onCancel={cancelEdit} busy={busy === r.id} />
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && !adding && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>no rules</div>
          )}
        </div>
      )}
    </div>
  )
}

function AxisEditor({ draft, onChange, onSave, onCancel, busy }: {
  draft: AxisDraft; onChange: (d: AxisDraft) => void
  onSave: () => void; onCancel: () => void; busy: boolean
}) {
  const set = <K extends keyof AxisDraft>(k: K, v: AxisDraft[K]) => onChange({ ...draft, [k]: v })
  const valid = !!draft.label.trim()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Label>Axis type</Label>
          <Select value={draft.axisType} onChange={(e) => set('axisType', e.target.value as MarsAxisType)}>
            {AXIS_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </Select>
        </div>
        <div style={{ flex: 2 }}>
          <Label>Label (unique within axis)</Label>
          <Input value={draft.label} onChange={(e) => set('label', e.target.value)} placeholder="rock-metal, breathy, lo-fi…" />
        </div>
      </div>
      <div>
        <Label>Match terms (comma-separated; trigger this rule when found in style fields)</Label>
        <Input
          value={draft.matchTerms.join(', ')}
          onChange={(e) => set('matchTerms', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
      </div>
      <div>
        <Label>Opposites (added to negative_style when this rule fires)</Label>
        <Input
          value={draft.opposites.join(', ')}
          onChange={(e) => set('opposites', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
      </div>
      <div>
        <Label>Secondary opposites (genre-axis-only — e.g., opposite instruments)</Label>
        <Input
          value={draft.secondaryOpposites.join(', ')}
          onChange={(e) => set('secondaryOpposites', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: T.sans, fontSize: S.small, color: T.text }}>
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set('isActive', e.target.checked)} /> active
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: T.sans, fontSize: S.small, color: T.text }}>
          sort
          <Input type="number" value={String(draft.sortOrder)} onChange={(e) => set('sortOrder', Number(e.target.value) || 0)} style={{ width: 60 }} />
        </label>
      </div>
      <div>
        <Label>Notes (changelog, optional)</Label>
        <Input value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="tiny" onClick={onCancel} disabled={busy}>cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={!valid} busy={busy}>{busy ? '…' : 'save'}</Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontFamily: T.sans, fontSize: S.body, color: T.text, fontWeight: 600,
      margin: 0, paddingTop: 8, borderTop: `1px solid ${T.borderSubtle}`,
    }}>{children}</h3>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'block', marginBottom: 4,
      fontFamily: T.sans, fontSize: S.label, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.03em',
    }}>{children}</span>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: `1px solid ${active ? T.accent : T.border}`,
    borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
    fontFamily: T.sans, fontSize: S.label, fontWeight: active ? 600 : 400,
  }
}
