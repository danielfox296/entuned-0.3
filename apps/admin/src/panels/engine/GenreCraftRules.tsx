import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { GenreCraftRuleRow } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, PanelHeader, S } from '../../ui/index.js'

type Draft = Omit<GenreCraftRuleRow, 'id' | 'updatedAt'>

const EMPTY: Draft = {
  familyName: '',
  tags: [],
  densityGuidance: '',
  rhymeGuidance: '',
  lineStructureGuidance: '',
  voiceGuidance: '',
  typographyGuidance: '',
  sortOrder: 0,
  isActive: true,
  notes: null,
}

export function GenreCraftRules() {
  const [rows, setRows] = useState<GenreCraftRuleRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [adding, setAdding] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.genreCraftRules(token)
      setRows(r)
    } catch (e: any) { setErr(e.message ?? 'load failed') }
    finally { setLoaded(true) }
  }

  useEffect(() => { load() }, [])

  const startEdit = (r: GenreCraftRuleRow) => {
    const { id: _id, updatedAt: _u, ...rest } = r
    setExpanded(r.id); setDraft(rest); setErr(null)
  }

  const cancelEdit = () => { setExpanded(null); setDraft(null) }

  const saveEdit = async () => {
    const token = getToken(); if (!token || !expanded || !draft) return
    setBusy(expanded); setErr(null)
    try {
      await api.updateGenreCraftRule(expanded, draft, token)
      cancelEdit(); await load()
    } catch (e: any) { setErr(e.message ?? 'save failed') }
    finally { setBusy(null) }
  }

  const remove = async (id: string, familyName: string) => {
    if (!confirm(`Delete genre-craft rule "${familyName}"?`)) return
    const token = getToken(); if (!token) return
    setBusy(id); setErr(null)
    try {
      await api.deleteGenreCraftRule(id, token)
      if (expanded === id) cancelEdit()
      await load()
    } catch (e: any) { setErr(e.message ?? 'delete failed') }
    finally { setBusy(null) }
  }

  const create = async () => {
    const token = getToken(); if (!token || !adding) return
    setBusy('__new__'); setErr(null)
    try {
      await api.createGenreCraftRule(adding, token)
      setAdding(null); await load()
    } catch (e: any) { setErr(e.message ?? 'create failed') }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <PanelHeader
        title="Genre Craft Rules"
        subtitle="Per-genre-family lyric craft overlays. Bernie's draft pass prepends the matching family's guidance onto the user message."
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button
          variant={adding ? 'ghost' : 'primary'}
          onClick={() => setAdding(adding ? null : { ...EMPTY, sortOrder: rows.length })}
        >{adding ? 'cancel' : '+ new rule'}</Button>
        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {adding && (
        <Editor
          draft={adding}
          onChange={setAdding}
          onSave={create}
          onCancel={() => setAdding(null)}
          busy={busy === '__new__'}
          isNew
        />
      )}

      {loaded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} style={{
              border: `1px solid ${T.border}`, borderRadius: S.r4,
              background: T.surface,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', cursor: 'pointer',
                borderBottom: expanded === r.id ? `1px solid ${T.borderSubtle}` : 'none',
              }}
              onClick={() => expanded === r.id ? cancelEdit() : startEdit(r)}>
                <span style={{
                  fontFamily: T.sans, fontSize: S.body, color: T.text, fontWeight: 600, flex: 1,
                }}>{r.familyName}</span>
                <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>
                  {r.tags.length} tag{r.tags.length === 1 ? '' : 's'}
                </span>
                {!r.isActive && (
                  <span style={{
                    fontFamily: T.sans, fontSize: S.label, color: T.textDim,
                    padding: '2px 6px', border: `1px solid ${T.border}`, borderRadius: 3,
                  }}>inactive</span>
                )}
                <Button
                  variant="tinyDanger"
                  onClick={(e: any) => { e.stopPropagation(); remove(r.id, r.familyName) }}
                  disabled={busy === r.id}
                >×</Button>
              </div>
              {expanded === r.id && draft && (
                <div style={{ padding: 14, background: T.surfaceRaised }}>
                  <Editor
                    draft={draft}
                    onChange={setDraft}
                    onSave={saveEdit}
                    onCancel={cancelEdit}
                    busy={busy === r.id}
                  />
                </div>
              )}
            </div>
          ))}
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

function Editor({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: Draft
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  busy: boolean
  isNew?: boolean
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  const valid = !!draft.familyName.trim() && !!draft.densityGuidance.trim()

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      ...(isNew ? { padding: 14, background: T.accentGlow, border: `1px solid ${T.accent}`, borderRadius: S.r4 } : {}),
    }}>
      <Field label="Family name (unique slug)">
        <Input value={draft.familyName} onChange={(e) => set('familyName', e.target.value)} placeholder="hip-hop, country, edm…" />
      </Field>
      <Field label="Tags (comma-separated; matched against reference track genre)">
        <Input
          value={draft.tags.join(', ')}
          onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
          placeholder="hip-hop, hip hop, rap, trap"
        />
      </Field>
      <TextareaField label="Density guidance" value={draft.densityGuidance} onChange={(v) => set('densityGuidance', v)} />
      <TextareaField label="Rhyme guidance" value={draft.rhymeGuidance} onChange={(v) => set('rhymeGuidance', v)} />
      <TextareaField label="Line structure guidance" value={draft.lineStructureGuidance} onChange={(v) => set('lineStructureGuidance', v)} />
      <TextareaField label="Voice guidance" value={draft.voiceGuidance} onChange={(v) => set('voiceGuidance', v)} />
      <TextareaField label="Performance typography guidance" value={draft.typographyGuidance} onChange={(v) => set('typographyGuidance', v)} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: T.sans, fontSize: S.small, color: T.text }}>
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          active
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: T.sans, fontSize: S.small, color: T.text }}>
          sort
          <Input type="number" value={String(draft.sortOrder)} onChange={(e) => set('sortOrder', Number(e.target.value) || 0)} style={{ width: 60 }} />
        </label>
      </div>
      <Field label="Notes (changelog, optional)">
        <Input value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="tiny" onClick={onCancel} disabled={busy}>cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={!valid} busy={busy}>{busy ? '…' : 'save'}</Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      {children}
    </div>
  )
}

function TextareaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{
          fontFamily: T.sans, fontSize: S.small, color: T.text,
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: S.r4,
          padding: 8, width: '100%', resize: 'vertical', minHeight: 80,
        }}
      />
    </Field>
  )
}
