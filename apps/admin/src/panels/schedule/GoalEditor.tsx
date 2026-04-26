import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, getToken } from '../../api.js'
import type { GoalRow, GoalDirection, GoalStatus, OutcomeRowFull, StoreSummary } from '../../api.js'
import { T } from '../../tokens.js'

type Filter = 'active' | 'all' | 'retired'

interface Draft {
  id?: string
  storeId: string
  outcomeId: string
  goalType: string
  targetMetric: string
  direction: GoalDirection
  status: GoalStatus
  startAt: string  // YYYY-MM-DD
  endAt: string    // YYYY-MM-DD or ''
  notes: string
}

const DIRECTIONS: GoalDirection[] = ['increase', 'decrease', 'maintain']
const STATUSES: GoalStatus[] = ['draft', 'active', 'paused', 'retired']

function todayISO(): string { return new Date().toISOString().slice(0, 10) }
function emptyDraft(): Draft {
  return {
    storeId: '', outcomeId: '', goalType: '', targetMetric: '',
    direction: 'increase', status: 'active',
    startAt: todayISO(), endAt: '', notes: '',
  }
}

export function GoalEditor() {
  const [goals, setGoals] = useState<GoalRow[] | null>(null)
  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRowFull[] | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [storeFilter, setStoreFilter] = useState<string>('')
  const [editor, setEditor] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = async () => {
    const token = getToken(); if (!token) return
    try {
      const [g, s, o] = await Promise.all([
        api.goals(token),
        api.stores(token),
        api.outcomes(token),
      ])
      setGoals(g); setStores(s); setOutcomes(o); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  const visible = useMemo(() => {
    if (!goals) return []
    return goals.filter((g) => {
      if (filter === 'active' && g.status !== 'active') return false
      if (filter === 'retired' && g.status !== 'retired') return false
      if (storeFilter && g.storeId !== storeFilter) return false
      return true
    })
  }, [goals, filter, storeFilter])

  const counts = {
    active: goals?.filter((g) => g.status === 'active').length ?? 0,
    retired: goals?.filter((g) => g.status === 'retired').length ?? 0,
    all: goals?.length ?? 0,
  }

  const startCreate = () => setEditor(emptyDraft())
  const startEdit = (g: GoalRow) => setEditor({
    id: g.id, storeId: g.storeId, outcomeId: g.outcomeId,
    goalType: g.goalType, targetMetric: g.targetMetric,
    direction: g.direction, status: g.status,
    startAt: g.startAt.slice(0, 10),
    endAt: g.endAt ? g.endAt.slice(0, 10) : '',
    notes: g.notes ?? '',
  })

  const submit = async () => {
    if (!editor) return
    const token = getToken(); if (!token) return
    if (!editor.storeId || !editor.outcomeId || !editor.goalType.trim() || !editor.targetMetric.trim()) {
      setErr('store, outcome, type, and metric are required')
      return
    }
    setBusy(editor.id ?? 'new'); setErr(null)
    try {
      const body = {
        storeId: editor.storeId,
        outcomeId: editor.outcomeId,
        goalType: editor.goalType.trim(),
        targetMetric: editor.targetMetric.trim(),
        direction: editor.direction,
        status: editor.status,
        startAt: new Date(editor.startAt + 'T00:00:00Z').toISOString(),
        endAt: editor.endAt ? new Date(editor.endAt + 'T00:00:00Z').toISOString() : null,
        notes: editor.notes.trim() || null,
      }
      if (editor.id) {
        const { storeId: _ignore, ...rest } = body
        await api.updateGoal(editor.id, rest, token)
      } else {
        await api.createGoal(body, token)
      }
      setEditor(null); await reload()
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const retire = async (g: GoalRow) => {
    const token = getToken(); if (!token) return
    if (!confirm(`Retire goal "${g.goalType}" for ${g.store.name}? It stays in the audit history.`)) return
    setBusy(g.id)
    try { await api.updateGoal(g.id, { status: 'retired' }, token); await reload() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  const del = async (g: GoalRow) => {
    const token = getToken(); if (!token) return
    if (!confirm(`Delete goal "${g.goalType}" for ${g.store.name}? This cannot be undone (use retire to keep audit history).`)) return
    setBusy(g.id)
    try { await api.deleteGoal(g.id, token); await reload() }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontFamily: T.sans, fontWeight: 500, color: T.text }}>Goal Editor</div>
        <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, marginTop: 4 }}>
          Advisory — documents <em>why</em> you scheduled an Outcome. Hendrix never reads goals; Kraftwerk evaluates them later.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['active', 'all', 'retired'] as const).map((f) => {
            const on = filter === f
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                background: on ? T.surfaceRaised : 'transparent',
                border: `1px solid ${on ? T.accent : T.border}`,
                color: on ? T.accent : T.textMuted,
                padding: '6px 14px', borderRadius: 4,
                fontFamily: T.mono, fontSize: 11, cursor: 'pointer',
              }}>{f} ({counts[f]})</button>
            )
          })}
        </div>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ ...inputStyle, width: 220 }}>
          <option value="">all stores</option>
          {stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={editor && !editor.id ? () => setEditor(null) : startCreate} style={primaryBtn(!editor || !!editor.id, false)}>
          {editor && !editor.id ? 'cancel' : '+ new goal'}
        </button>
      </div>

      {editor && (
        <div style={{
          border: `1px solid ${editor.id ? T.borderSubtle : T.accentMuted}`,
          background: editor.id ? 'transparent' : T.accentGlow,
          borderRadius: 4, padding: 14,
          display: 'grid', gridTemplateColumns: '1.4fr 1.4fr 1fr 1fr 0.8fr 0.8fr 0.9fr 0.9fr', gap: 10,
        }}>
          <div>
            <label style={labelStyle}>store</label>
            <select value={editor.storeId} disabled={!!editor.id}
              onChange={(e) => setEditor({ ...editor, storeId: e.target.value })} style={inputStyle}>
              <option value="">—</option>
              {stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>outcome</label>
            <select value={editor.outcomeId}
              onChange={(e) => setEditor({ ...editor, outcomeId: e.target.value })} style={inputStyle}>
              <option value="">—</option>
              {outcomes?.map((o) => <option key={o.id} value={o.id}>{o.title} v{o.version}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>goal type</label>
            <input value={editor.goalType} onChange={(e) => setEditor({ ...editor, goalType: e.target.value })}
              placeholder="dwell_lift" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>target metric</label>
            <input value={editor.targetMetric} onChange={(e) => setEditor({ ...editor, targetMetric: e.target.value })}
              placeholder="avg_dwell_seconds" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>direction</label>
            <select value={editor.direction}
              onChange={(e) => setEditor({ ...editor, direction: e.target.value as GoalDirection })} style={inputStyle}>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>status</label>
            <select value={editor.status}
              onChange={(e) => setEditor({ ...editor, status: e.target.value as GoalStatus })} style={inputStyle}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>start</label>
            <input type="date" value={editor.startAt}
              onChange={(e) => setEditor({ ...editor, startAt: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>end (optional)</label>
            <input type="date" value={editor.endAt}
              onChange={(e) => setEditor({ ...editor, endAt: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>notes</label>
            <textarea value={editor.notes} onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
              placeholder="Research-seeded; metric measurement pending RetailNext."
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: T.mono }} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
            <button onClick={submit} disabled={!!busy} style={primaryBtn(true, !!busy)}>
              {busy ? 'saving…' : (editor.id ? 'save' : 'create')}
            </button>
            <button onClick={() => setEditor(null)} style={tinyBtn}>cancel</button>
          </div>
        </div>
      )}

      {err && <div style={{ fontSize: 11, color: T.danger, fontFamily: T.mono }}>{err}</div>}
      {!goals && <div style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 12 }}>loading…</div>}

      {goals && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <HeaderRow />
          {visible.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 12 }}>
              no goals — click "+ new goal" to document the why behind a schedule entry
            </div>
          )}
          {visible.map((g) => (
            <DataRow key={g.id} row={g} onEdit={() => startEdit(g)} onRetire={() => retire(g)} onDelete={() => del(g)} busy={busy === g.id} />
          ))}
        </div>
      )}
    </div>
  )
}

const COLS = '1.2fr 1.4fr 1fr 1fr 90px 80px 110px 130px'

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '8px 12px', background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      fontFamily: T.mono, fontSize: 10, color: T.textDim, textTransform: 'uppercase',
    }}>
      <span>store</span>
      <span>outcome</span>
      <span>type</span>
      <span>metric</span>
      <span>direction</span>
      <span>status</span>
      <span>window</span>
      <span></span>
    </div>
  )
}

function DataRow({ row, onEdit, onRetire, onDelete, busy }: {
  row: GoalRow; onEdit: () => void; onRetire: () => void; onDelete: () => void; busy: boolean
}) {
  const retired = row.status === 'retired'
  const start = row.startAt.slice(0, 10)
  const end = row.endAt ? row.endAt.slice(0, 10) : '∞'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, gap: 10,
      padding: '10px 12px', borderBottom: `1px solid ${T.borderSubtle}`,
      fontFamily: T.mono, fontSize: 11, alignItems: 'center',
      opacity: retired ? 0.55 : 1,
    }}>
      <span style={{ color: T.text, fontFamily: T.sans, fontWeight: 500 }}>{row.store.name}</span>
      <span style={cellTrunc}>{row.outcome.title} <span style={{ color: T.accentMuted }}>v{row.outcome.version}</span></span>
      <span style={cellTrunc}>{row.goalType}</span>
      <span style={cellTrunc}>{row.targetMetric}</span>
      <span style={{ color: T.textMuted }}>{row.direction}</span>
      <span style={{ color: row.status === 'active' ? T.success : T.textDim, fontSize: 10 }}>{row.status}</span>
      <span style={{ color: T.textMuted, fontSize: 10 }}>{start} → {end}</span>
      <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button onClick={onEdit} disabled={busy} style={tinyBtn}>edit</button>
        {!retired && <button onClick={onRetire} disabled={busy} style={tinyBtn}>retire</button>}
        <button onClick={onDelete} disabled={busy} style={tinyDangerBtn}>del</button>
      </span>
    </div>
  )
}

const cellTrunc: CSSProperties = {
  color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const inputStyle: CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  fontFamily: T.mono, fontSize: 11, padding: '6px 10px', borderRadius: 3, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

const labelStyle: CSSProperties = {
  display: 'block', fontSize: 9, color: T.textDim, fontFamily: T.mono,
  textTransform: 'uppercase', marginBottom: 3,
}

function primaryBtn(active: boolean, busy: boolean): CSSProperties {
  return {
    background: active ? T.accent : T.surfaceRaised,
    color: active ? T.bg : T.textMuted,
    border: 'none', borderRadius: 3, padding: '6px 12px',
    fontFamily: T.mono, fontSize: 11, fontWeight: 600,
    cursor: active && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.6 : 1,
  }
}

const tinyBtn: CSSProperties = {
  background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
  padding: '3px 9px', borderRadius: 2, fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
}

const tinyDangerBtn: CSSProperties = {
  ...tinyBtn, borderColor: T.danger, color: T.danger,
}
