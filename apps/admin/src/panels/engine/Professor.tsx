// The Professor panel — persona (versioned, top) + curriculum modules (CRUD list, bottom).
// Same shape conventions as LyricPrompts.tsx (VersionedPromptEditor) and LyricBanList.tsx (inline-edit list).

import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { LyricPromptRow, ProfessorModuleRow, ProfessorModuleDraft } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, PanelHeader, VersionedPromptEditor, S } from '../../ui/index.js'

export function Professor() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <VersionedPromptEditor
        title="Professor — Persona"
        subtitle="The systemic role the finishing editor plays. Holds restraint, voice preservation, and the touch budget."
        load={async () => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          return api.professorPersona(token)
        }}
        textFrom={(latest: LyricPromptRow | null) => latest?.promptText ?? ''}
        save={async (text, notes) => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          await api.saveProfessorPersona(text, notes, token)
        }}
      />
      <ModuleList />
    </div>
  )
}

type Editing = ProfessorModuleDraft & { id?: string }

const EMPTY: Editing = { name: '', body: '', active: true }

function ModuleList() {
  const [rows, setRows] = useState<ProfessorModuleRow[]>([])
  const [editing, setEditing] = useState<Record<string, Editing>>({})
  const [adding, setAdding] = useState<Editing | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.professorModules(token)
      setRows(r); setEditing({})
    } catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
  }

  useEffect(() => { load() }, [])

  const startEdit = (r: ProfessorModuleRow) => {
    setEditing({ ...editing, [r.id]: { name: r.name, body: r.body, active: r.active, sortOrder: r.sortOrder } })
  }
  const cancelEdit = (id: string) => {
    const next = { ...editing }; delete next[id]; setEditing(next)
  }
  const saveEdit = async (id: string) => {
    const token = getToken(); const draft = editing[id]
    if (!token || !draft) return
    setBusy(id); setErr(null)
    try {
      await api.updateProfessorModule(id, normalize(draft), token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(null) }
  }
  const remove = async (id: string) => {
    const token = getToken(); if (!token) return
    setBusy(id); setErr(null)
    try {
      await api.deleteProfessorModule(id, token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'delete failed') }
    finally { setBusy(null) }
  }
  const toggleActive = async (r: ProfessorModuleRow) => {
    const token = getToken(); if (!token) return
    setBusy(r.id); setErr(null)
    try {
      await api.updateProfessorModule(r.id, { active: !r.active }, token)
      await load()
    } catch (e: any) { setErr(e.message ?? 'toggle failed') }
    finally { setBusy(null) }
  }
  const create = async () => {
    const token = getToken(); if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try {
      await api.createProfessorModule(normalize(adding), token)
      setAdding(null); await load()
    } catch (e: any) { setErr(e.message ?? 'create failed') }
    finally { setBusy(null) }
  }

  const activeCount = rows.filter((r) => r.active).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader
        title="Professor — Curriculum modules"
        subtitle={`Craft lenses the persona reads each line through. ${activeCount}/${rows.length} active. Order is salience-first — the persona attends most to the top.`}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button
          variant={adding ? 'ghost' : 'primary'}
          onClick={() => setAdding(adding ? null : { ...EMPTY })}
        >{adding ? 'cancel' : '+ new module'}</Button>
        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {loaded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
          {adding && (
            <ModuleCard
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
              <ModuleCard
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
              no modules yet — the persona will seed v1 from code on first call
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normalize(d: Editing): ProfessorModuleDraft {
  return {
    name: d.name.trim(),
    body: d.body.trim(),
    active: d.active ?? true,
    ...(typeof d.sortOrder === 'number' ? { sortOrder: d.sortOrder } : {}),
  }
}

function DisplayCard({ row, onEdit, onDelete, onToggleActive, busy }: {
  row: ProfessorModuleRow
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
            fontFamily: T.mono, fontSize: S.label, color: T.textDim, minWidth: 28,
          }}>{row.sortOrder}</span>
          <span style={{ fontFamily: T.sans, fontSize: S.subhead, color: T.text, fontWeight: 600 }}>
            {row.name}
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
      <pre style={{
        fontFamily: T.mono, fontSize: S.small, color: T.textMuted,
        whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5,
      }}>{row.body}</pre>
    </div>
  )
}

function ModuleCard({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: Editing; onChange: (d: Editing) => void
  onSave: () => void; onCancel: () => void; busy: boolean; isNew?: boolean
}) {
  const set = <K extends keyof Editing>(k: K, v: Editing[K]) => onChange({ ...draft, [k]: v })
  const valid = draft.name.trim().length > 0 && draft.body.trim().length > 0
  return (
    <div style={{
      border: `1px solid ${T.accentMuted}`, borderRadius: S.r4, padding: 16,
      background: isNew ? T.accentGlow : T.surfaceRaised,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="module name (e.g. Concrete embodiment)"
          style={{ flex: 1 }}
        />
        <Input
          value={typeof draft.sortOrder === 'number' ? String(draft.sortOrder) : ''}
          onChange={(e) => {
            const n = e.target.value.trim()
            set('sortOrder', n === '' ? undefined : Number(n))
          }}
          placeholder="sort"
          style={{ width: 70 }}
        />
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
        value={draft.body}
        onChange={(e) => set('body', e.target.value)}
        placeholder={'Principle: ...\nLLM failure: ...\nCorrection: ...'}
        rows={6}
        style={{
          fontFamily: T.mono, fontSize: S.small, color: T.text,
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
