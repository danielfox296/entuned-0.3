import { useEffect, useMemo, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { FormArchetypeRow, FormArchetypeWriteBody, FormArchetypeEraRange } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, Textarea, Section, S, useToast } from '../../ui/index.js'

type OutcomeStub = { outcomeKey: string; title: string }

const SECTION_KEYS = ['intro', 'verse', 'pre_chorus', 'chorus', 'bridge', 'outro'] as const

const EMPTY_DRAFT: FormArchetypeWriteBody = {
  slug: '',
  displayName: '',
  sectionList: '',
  shapeNote: '',
  requiresSections: [],
  outcomeWeights: { '*': 1 },
  eraWeights: null,
  isActive: true,
  notes: null,
}

function rowToBody(r: FormArchetypeRow): FormArchetypeWriteBody {
  return {
    slug: r.slug,
    displayName: r.displayName,
    sectionList: r.sectionList,
    shapeNote: r.shapeNote,
    requiresSections: r.requiresSections,
    outcomeWeights: r.outcomeWeights,
    eraWeights: r.eraWeights,
    isActive: r.isActive,
    notes: r.notes,
  }
}

function bodiesEqual(a: FormArchetypeWriteBody, b: FormArchetypeWriteBody): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * FormArchetype editor. Eno's selector picks one archetype per generation and
 * passes its sectionList + shapeNote into Bernie. outcomeWeights are keyed on
 * outcome_key (cross-version stable id) plus "*" default. eraWeights gates
 * archetypes by reference-track year (e.g. "loop" only fires for 1975-1985 +
 * post-2010 references).
 */
export function FormArchetypes() {
  const [archetypes, setArchetypes] = useState<FormArchetypeRow[] | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeStub[]>([])
  const [draftById, setDraftById] = useState<Record<string, FormArchetypeWriteBody>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState<FormArchetypeWriteBody | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const toast = useToast()

  const reload = async () => {
    const token = getToken(); if (!token) return
    try {
      const r = await api.formArchetypes(token)
      setArchetypes(r.archetypes)
      setOutcomes(r.outcomes)
      if (!activeId && r.archetypes.length > 0) setActiveId(r.archetypes[0]!.id)
      setErr(null)
    } catch (e: any) { setErr(e.message ?? 'load failed') }
  }

  useEffect(() => { void reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const active = useMemo(
    () => (archetypes && activeId ? archetypes.find((a) => a.id === activeId) ?? null : null),
    [archetypes, activeId],
  )
  const draft = active ? (draftById[active.id] ?? rowToBody(active)) : null
  const dirty = !!active && !!draft && !bodiesEqual(draft, rowToBody(active))

  const updateDraft = (next: FormArchetypeWriteBody) => {
    if (!active) return
    setDraftById({ ...draftById, [active.id]: next })
  }

  const save = async () => {
    if (!active || !draft || !dirty) return
    const token = getToken(); if (!token) return
    setBusy(active.id); setErr(null)
    try {
      await api.updateFormArchetype(active.id, draft, token)
      setDraftById((d) => { const n = { ...d }; delete n[active.id]; return n })
      await reload()
      toast.success(`saved ${draft.slug}`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to save') }
    finally { setBusy(null) }
  }

  const remove = async () => {
    if (!active) return
    if (!window.confirm(`Delete archetype "${active.slug}"? This is permanent.`)) return
    const token = getToken(); if (!token) return
    setBusy(active.id); setErr(null)
    try {
      await api.deleteFormArchetype(active.id, token)
      setActiveId(null)
      await reload()
      toast.success(`deleted ${active.slug}`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to delete') }
    finally { setBusy(null) }
  }

  const create = async () => {
    if (!creating) return
    const token = getToken(); if (!token) return
    setBusy('__new__'); setErr(null)
    try {
      const created = await api.createFormArchetype(creating, token)
      setCreating(null)
      await reload()
      setActiveId(created.id)
      toast.success(`created ${created.slug}`)
    } catch (e: any) { setErr(e.message); toast.error(e.message ?? 'failed to create') }
    finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      {err && <div style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</div>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button
          variant={creating ? 'ghost' : 'primary'}
          onClick={() => { setCreating(creating ? null : { ...EMPTY_DRAFT }); setActiveId(null) }}
        >{creating ? 'cancel new' : '+ new archetype'}</Button>
        <span style={{ fontSize: S.small, color: T.textDim, fontFamily: T.sans }}>
          {archetypes?.length ?? 0} archetype{archetypes?.length === 1 ? '' : 's'}
        </span>
      </div>

      {!archetypes && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading…</div>}

      {archetypes && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
          {/* List */}
          <div style={{
            border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden',
            background: T.surface,
          }}>
            {archetypes.map((a) => {
              const on = a.id === activeId && !creating
              const isDirty = !!draftById[a.id]
              return (
                <button
                  key={a.id}
                  onClick={() => { setCreating(null); setActiveId(a.id) }}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: on ? T.accentGlow : 'transparent',
                    border: 'none',
                    borderLeft: on ? `2px solid ${T.accent}` : '2px solid transparent',
                    borderBottom: `1px solid ${T.borderSubtle}`,
                    color: T.text,
                    padding: '10px 12px', cursor: 'pointer',
                    fontFamily: T.sans, fontSize: S.small,
                    display: 'flex', flexDirection: 'column', gap: 3,
                    opacity: a.isActive ? 1 : 0.5,
                  }}
                >
                  <span style={{ fontWeight: on ? 500 : 400 }}>
                    {a.slug}
                    {isDirty && <span style={{ color: T.warn, marginLeft: 6 }}>•</span>}
                    {!a.isActive && <span style={{ color: T.textDim, marginLeft: 6, fontSize: S.label }}>(inactive)</span>}
                  </span>
                  <span style={{ fontSize: S.label, color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.displayName}
                  </span>
                </button>
              )
            })}
            {archetypes.length === 0 && (
              <div style={{ padding: 16, color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
                no archetypes — click "+ new archetype" to add one, or run the seed script
              </div>
            )}
          </div>

          {/* Editor */}
          {creating ? (
            <ArchetypeEditor
              draft={creating}
              onChange={setCreating}
              outcomes={outcomes}
              isNew
              onPrimary={create}
              primaryDisabled={!creating.slug.trim() || !creating.displayName.trim() || !creating.sectionList.trim() || !creating.shapeNote.trim()}
              primaryBusy={busy === '__new__'}
              primaryLabel="create"
              onCancel={() => setCreating(null)}
            />
          ) : active && draft ? (
            <ArchetypeEditor
              draft={draft}
              onChange={updateDraft}
              outcomes={outcomes}
              onPrimary={save}
              primaryDisabled={!dirty}
              primaryBusy={busy === active.id}
              primaryLabel={dirty ? 'save changes' : 'no changes'}
              onCancel={dirty ? () => setDraftById((d) => { const n = { ...d }; delete n[active.id]; return n }) : undefined}
              onDelete={remove}
              meta={`updated ${new Date(active.updatedAt).toLocaleString()}`}
            />
          ) : (
            <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.small }}>
              pick an archetype on the left to edit, or click "+ new archetype"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Editor ──

function ArchetypeEditor({
  draft, onChange, outcomes,
  isNew, onPrimary, primaryDisabled, primaryBusy, primaryLabel, onCancel, onDelete, meta,
}: {
  draft: FormArchetypeWriteBody
  onChange: (d: FormArchetypeWriteBody) => void
  outcomes: OutcomeStub[]
  isNew?: boolean
  onPrimary: () => void
  primaryDisabled: boolean
  primaryBusy: boolean
  primaryLabel: string
  onCancel?: () => void
  onDelete?: () => void
  meta?: string
}) {
  const set = <K extends keyof FormArchetypeWriteBody>(k: K, v: FormArchetypeWriteBody[K]) =>
    onChange({ ...draft, [k]: v })

  const setWeight = (key: string, weight: number) => {
    const next = { ...draft.outcomeWeights, [key]: weight }
    onChange({ ...draft, outcomeWeights: next })
  }
  const removeWeightKey = (key: string) => {
    if (key === '*') return  // protect default
    const next = { ...draft.outcomeWeights }
    delete next[key]
    onChange({ ...draft, outcomeWeights: next })
  }

  const eraRanges = draft.eraWeights?.ranges ?? []
  const setEraRanges = (ranges: FormArchetypeEraRange[]) => {
    onChange({ ...draft, eraWeights: ranges.length === 0 ? null : { ranges } })
  }

  return (
    <Section
      title={isNew ? 'New archetype' : `Editing "${draft.slug}"`}
      subtitle="Eno picks one archetype per generation and passes sectionList + shapeNote into Bernie. Weights skew the random pick; era ranges gate by reference-track year."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="slug" hint="stable identifier; use snake_case (vcvcbc, aaba, vcvc, intro_driven, loop, tag_out, ...)">
          <Input
            value={draft.slug}
            onChange={(e) => set('slug', e.target.value)}
            disabled={!isNew}
            placeholder="vcvcbc"
          />
        </Field>

        <Field label="display name" hint="operator-facing label">
          <Input
            value={draft.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="V-C-V-C-Bridge-Final C (current default)"
          />
        </Field>

        <Field label="section list" hint="passed verbatim to Bernie as the section structure to write into">
          <Textarea
            value={draft.sectionList}
            onChange={(e) => set('sectionList', e.target.value)}
            rows={3}
            placeholder="[Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Final Chorus]"
          />
        </Field>

        <Field label="shape note" hint="one to three sentences explaining the form's logic to Bernie. For AABA-style forms, instruct where the hook lands.">
          <Textarea
            value={draft.shapeNote}
            onChange={(e) => set('shapeNote', e.target.value)}
            rows={5}
            placeholder="Standard pop arc — two verse-chorus cycles, a bridge that contrasts in image or stance, then a final chorus that lands."
          />
        </Field>

        <Field label="requires sections" hint="archetype is only eligible when the reference track's arrangementSections contains all of these. Empty = no constraint.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SECTION_KEYS.map((k) => {
              const on = draft.requiresSections.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => set('requiresSections',
                    on
                      ? draft.requiresSections.filter((s) => s !== k)
                      : [...draft.requiresSections, k],
                  )}
                  style={{
                    padding: '4px 10px', borderRadius: 12, cursor: 'pointer',
                    border: `1px solid ${on ? T.accent : T.border}`,
                    background: on ? T.accentGlow : 'transparent',
                    color: on ? T.text : T.textMuted,
                    fontFamily: T.sans, fontSize: S.label,
                  }}
                >{k}</button>
              )
            })}
          </div>
        </Field>

        <Field label="outcome weights" hint='per-outcome bias. "*" is the fallback for any outcome without an explicit weight. 0 disables the archetype for that outcome.'>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Default row */}
            <WeightRow
              label="* (default)"
              weight={typeof draft.outcomeWeights['*'] === 'number' ? draft.outcomeWeights['*'] : 1}
              onChange={(w) => setWeight('*', w)}
            />
            {/* Per-outcome rows */}
            {outcomes.map((o) => {
              const explicit = Object.prototype.hasOwnProperty.call(draft.outcomeWeights, o.outcomeKey)
              const w = explicit ? draft.outcomeWeights[o.outcomeKey]! : null
              return (
                <WeightRow
                  key={o.outcomeKey}
                  label={o.title}
                  weight={w}
                  onChange={(weight) => setWeight(o.outcomeKey, weight)}
                  onClear={explicit ? () => removeWeightKey(o.outcomeKey) : undefined}
                />
              )
            })}
            {/* Orphan keys (outcomeWeights entries that don't match any active outcome) */}
            {Object.keys(draft.outcomeWeights)
              .filter((k) => k !== '*' && !outcomes.find((o) => o.outcomeKey === k))
              .map((k) => (
                <WeightRow
                  key={k}
                  label={`(unknown outcome ${k.slice(0, 8)}…)`}
                  weight={draft.outcomeWeights[k]!}
                  onChange={(w) => setWeight(k, w)}
                  onClear={() => removeWeightKey(k)}
                />
              ))}
          </div>
        </Field>

        <Field label="era weights" hint="optional. Each range that contains the reference track's year multiplies the base weight. Empty = era-agnostic (no multiplier).">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {eraRanges.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Input
                  width={90}
                  type="number"
                  placeholder="min year"
                  value={r.minYear ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                    setEraRanges(eraRanges.map((x, j) => j === i ? { ...x, minYear: v } : x))
                  }}
                />
                <span style={{ color: T.textDim, fontFamily: T.sans }}>–</span>
                <Input
                  width={90}
                  type="number"
                  placeholder="max year"
                  value={r.maxYear ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                    setEraRanges(eraRanges.map((x, j) => j === i ? { ...x, maxYear: v } : x))
                  }}
                />
                <span style={{ color: T.textDim, fontFamily: T.sans, fontSize: S.label }}>weight ×</span>
                <Input
                  width={70}
                  type="number"
                  step="0.1"
                  value={r.weight}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setEraRanges(eraRanges.map((x, j) => j === i ? { ...x, weight: Number.isFinite(v) ? v : 0 } : x))
                  }}
                />
                <Button variant="tinyDanger" onClick={() => setEraRanges(eraRanges.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <div>
              <Button
                variant="tiny"
                onClick={() => setEraRanges([...eraRanges, { minYear: null, maxYear: null, weight: 1 }])}
              >+ add range</Button>
            </div>
          </div>
        </Field>

        <Field label="active">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: T.sans, fontSize: S.small, color: T.text, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            <span>{draft.isActive ? 'eligible for selection' : 'never selected'}</span>
          </label>
        </Field>

        <Field label="notes" hint="operator notes (optional)">
          <Textarea
            value={draft.notes ?? ''}
            onChange={(e) => set('notes', e.target.value || null)}
            rows={2}
          />
        </Field>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <Button onClick={onPrimary} disabled={primaryDisabled} busy={primaryBusy}>
            {primaryBusy ? '…' : primaryLabel}
          </Button>
          {onCancel && (
            <Button variant="tiny" onClick={onCancel}>{isNew ? 'cancel' : 'discard'}</Button>
          )}
          <span style={{ flex: 1 }} />
          {meta && (
            <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim }}>{meta}</span>
          )}
          {onDelete && (
            <Button variant="tinyDanger" onClick={onDelete}>delete</Button>
          )}
        </div>
      </div>
    </Section>
  )
}

function WeightRow({ label, weight, onChange, onClear }: {
  label: string
  weight: number | null
  onChange: (w: number) => void
  onClear?: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ flex: 1, fontFamily: T.sans, fontSize: S.small, color: weight == null ? T.textDim : T.text }}>
        {label}
      </span>
      <Input
        width={70}
        type="number"
        step="0.5"
        value={weight ?? ''}
        placeholder="(default)"
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isFinite(v) || v < 0) return
          onChange(v)
        }}
      />
      {onClear && <Button variant="tinyDanger" onClick={onClear}>×</Button>}
    </div>
  )
}

// Local Field wrapper — minimal, mirrors the look of Layout.Field but keeps inline
// hint text. Avoids importing the heavier Layout.Field which expects different props.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontFamily: T.sans, fontSize: S.label, color: T.textDim, lineHeight: 1.45 }}>
          {hint}
        </span>
      )}
      {children}
    </div>
  )
}
