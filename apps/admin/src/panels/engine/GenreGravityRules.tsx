// Genre Steering Rules — bidirectional rule table keyed on genre tag.
// When Mars's positive style contains the tag (case-insensitive substring),
// two independent injections can fire:
//   - counterExclusions: added to negativeStyle by Music Professor module 2
//     (LLM-mediated). Carves the song AWAY from a default centroid.
//   - positivePalettes: one randomly picked, appended to positive style by
//     Mars deterministically (no LLM). Steers TOWARD genre-authentic
//     harmony — verified 2026-05-26 that text tokens like "I-IV vamp" or
//     "tonic drone" do influence Suno's chord motion.
//   - vocalCharacters / vocalDeliveries / vocalEffects: triple-stack vocal
//     identity. Mars picks one from each and composes a vocal identity string
//     placed BEFORE the genre anchor, where Suno reads it hardest.
// All fields are independent — a row may have any combination.

import { useEffect, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { GenreGravityRuleRow, GenreGravityRuleDraft } from '../../api.js'
import { T } from '@entuned/tokens'
import { Button, Input, PanelHeader, S } from '../../ui/index.js'

type Editing = GenreGravityRuleDraft & {
  id?: string
  _exclusionsText?: string
  _palettesText?: string
  _vocalsText?: string
  _charactersText?: string
  _deliveriesText?: string
  _effectsText?: string
}

const EMPTY: Editing = {
  tag: '',
  counterExclusions: [],
  positivePalettes: [],
  vocalDescriptors: [],
  vocalCharacters: [],
  vocalDeliveries: [],
  vocalEffects: [],
  notes: '',
  active: true,
  _exclusionsText: '',
  _palettesText: '',
  _vocalsText: '',
  _charactersText: '',
  _deliveriesText: '',
  _effectsText: '',
}

function fromRow(r: GenreGravityRuleRow): Editing {
  return {
    tag: r.tag,
    counterExclusions: r.counterExclusions,
    positivePalettes: r.positivePalettes,
    vocalDescriptors: r.vocalDescriptors,
    vocalCharacters: r.vocalCharacters,
    vocalDeliveries: r.vocalDeliveries,
    vocalEffects: r.vocalEffects,
    notes: r.notes ?? '',
    active: r.active,
    _exclusionsText: r.counterExclusions.join(', '),
    _palettesText: r.positivePalettes.join(', '),
    _vocalsText: r.vocalDescriptors.join(', '),
    _charactersText: r.vocalCharacters.join(', '),
    _deliveriesText: r.vocalDeliveries.join(', '),
    _effectsText: r.vocalEffects.join(', '),
  }
}

function splitCommas(s: string | undefined): string[] {
  return (s ?? '').split(',').map((x) => x.trim()).filter(Boolean)
}

function normalize(d: Editing): GenreGravityRuleDraft {
  return {
    tag: d.tag.trim(),
    counterExclusions: splitCommas(d._exclusionsText),
    positivePalettes: splitCommas(d._palettesText),
    vocalDescriptors: splitCommas(d._vocalsText),
    vocalCharacters: splitCommas(d._charactersText),
    vocalDeliveries: splitCommas(d._deliveriesText),
    vocalEffects: splitCommas(d._effectsText),
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
      await api.updateGenreGravityRule(r.id, { active: !r.active } as any, token)
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
        title="Genre Steering Rules"
        subtitle={`Bidirectional rules keyed on genre tag. ${activeCount}/${rows.length} active. counter-exclusions push AWAY from a centroid. positive-palettes push TOWARD genre-authentic harmony. Vocal triple-stack (character + delivery + effect) composes a vocal identity placed before the genre anchor.`}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button
          variant={adding ? 'ghost' : 'primary'}
          onClick={() => setAdding(adding ? null : { ...EMPTY })}
        >{adding ? 'cancel' : '+ new rule'}</Button>
        {err && <span style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{err}</span>}
      </div>

      {!loaded && <div style={{ color: T.textMuted, fontFamily: T.sans, fontSize: S.small }}>loading...</div>}

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
              no rules yet — both steering directions are no-ops until you populate
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TagLine({ color, label, items }: { color: string; label: string; items: string[] }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ color, fontWeight: 600 }}>{label} →</span>{' '}
      {items.length > 0 ? items.join(', ') : <em style={{ color: T.textDim }}>(none)</em>}
    </div>
  )
}

function DisplayCard({ row, onEdit, onDelete, onToggleActive, busy }: {
  row: GenreGravityRuleRow
  onEdit: () => void; onDelete: () => void; onToggleActive: () => void; busy: boolean
}) {
  const hasTripleStack = row.vocalCharacters.length > 0
    || row.vocalDeliveries.length > 0
    || row.vocalEffects.length > 0
  return (
    <div style={{
      border: `1px solid ${row.active ? T.border : T.borderSubtle}`,
      borderRadius: S.r4, padding: 16, background: T.surface,
      opacity: row.active ? 1 : 0.55,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
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
          <Button variant="tinyDanger" onClick={onDelete} disabled={busy}>x</Button>
        </div>
      </div>
      <div style={{
        fontFamily: T.mono, fontSize: S.small, color: T.textMuted, lineHeight: 1.5,
      }}>
        <TagLine color={T.danger} label="away" items={row.counterExclusions} />
        <TagLine color={T.success} label="harmony" items={row.positivePalettes} />
        {hasTripleStack ? (
          <>
            <TagLine color={T.gold} label="voice:character" items={row.vocalCharacters} />
            <TagLine color={T.gold} label="voice:delivery" items={row.vocalDeliveries} />
            <TagLine color={T.gold} label="voice:effect" items={row.vocalEffects} />
          </>
        ) : (
          <TagLine color={T.gold} label="vocal (legacy)" items={row.vocalDescriptors} />
        )}
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

const TA_STYLE: React.CSSProperties = {
  fontFamily: T.mono, fontSize: S.small, color: T.text,
  background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4,
  padding: 10, resize: 'vertical', lineHeight: 1.5,
}

function RuleCard({ draft, onChange, onSave, onCancel, busy, isNew }: {
  draft: Editing; onChange: (d: Editing) => void
  onSave: () => void; onCancel: () => void; busy: boolean; isNew?: boolean
}) {
  const set = <K extends keyof Editing>(k: K, v: Editing[K]) => onChange({ ...draft, [k]: v })
  const hasExclusions = (draft._exclusionsText ?? '').trim().length > 0
  const hasPalettes = (draft._palettesText ?? '').trim().length > 0
  const hasVocals = (draft._vocalsText ?? '').trim().length > 0
  const hasCharacters = (draft._charactersText ?? '').trim().length > 0
  const hasDeliveries = (draft._deliveriesText ?? '').trim().length > 0
  const hasEffects = (draft._effectsText ?? '').trim().length > 0
  const valid = draft.tag.trim().length > 0
    && (hasExclusions || hasPalettes || hasVocals || hasCharacters || hasDeliveries || hasEffects)
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
          placeholder='tag (e.g. "country", "soft rock")'
          style={{ flex: 1, minWidth: 180 }}
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
      <label style={{ fontFamily: T.sans, fontSize: S.small, color: T.danger, fontWeight: 600 }}>away from (counter-exclusions, comma-separated)</label>
      <textarea
        value={draft._exclusionsText ?? ''}
        onChange={(e) => set('_exclusionsText', e.target.value)}
        placeholder="smooth jazz, adult contemporary, easy listening"
        rows={2}
        style={TA_STYLE}
      />
      <label style={{ fontFamily: T.sans, fontSize: S.small, color: T.success, fontWeight: 600 }}>harmony (positive palettes, comma-separated)</label>
      <textarea
        value={draft._palettesText ?? ''}
        onChange={(e) => set('_palettesText', e.target.value)}
        placeholder="I-IV vamp, I-V pendulum, I-IV-V three-chord"
        rows={2}
        style={TA_STYLE}
      />

      <div style={{
        border: `1px solid ${T.gold}33`, borderRadius: S.r4, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <label style={{ fontFamily: T.sans, fontSize: S.small, color: T.gold, fontWeight: 600 }}>
          vocal triple-stack (character + delivery + effect — Mars picks one from each per song)
        </label>
        <label style={{ fontFamily: T.sans, fontSize: 11, color: T.textDim }}>character — voice texture (raspy, breathy, smooth, gritty, silky, gravelly, sultry, husky, velvety)</label>
        <textarea
          value={draft._charactersText ?? ''}
          onChange={(e) => set('_charactersText', e.target.value)}
          placeholder="raspy, breathy, smooth, gritty, silky, gravelly, husky"
          rows={2}
          style={TA_STYLE}
        />
        <label style={{ fontFamily: T.sans, fontSize: 11, color: T.textDim }}>delivery — how they sing (intimate, powerful, conversational, belted, whispered, soaring, laid-back, commanding)</label>
        <textarea
          value={draft._deliveriesText ?? ''}
          onChange={(e) => set('_deliveriesText', e.target.value)}
          placeholder="intimate, conversational, laid-back, behind-the-beat"
          rows={2}
          style={TA_STYLE}
        />
        <label style={{ fontFamily: T.sans, fontSize: 11, color: T.textDim }}>effect — production on the vocal (close-mic, dry studio, reverb-drenched, compressed, lo-fi, tape-saturated)</label>
        <textarea
          value={draft._effectsText ?? ''}
          onChange={(e) => set('_effectsText', e.target.value)}
          placeholder="close-mic, dry studio, tape-saturated"
          rows={2}
          style={TA_STYLE}
        />
      </div>

      {(hasVocals && (hasCharacters || hasDeliveries || hasEffects)) && (
        <div style={{ fontFamily: T.sans, fontSize: 11, color: T.gold }}>
          triple-stack fields take precedence over legacy vocal field when both are populated
        </div>
      )}
      {hasVocals && !hasCharacters && !hasDeliveries && !hasEffects && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontFamily: T.sans, fontSize: S.small, color: T.textDim, fontWeight: 600 }}>vocal legacy (flat descriptors — migrate to triple-stack above)</label>
          <textarea
            value={draft._vocalsText ?? ''}
            onChange={(e) => set('_vocalsText', e.target.value)}
            placeholder="drawl, twang, half-spoken, breathy"
            rows={2}
            style={TA_STYLE}
          />
        </div>
      )}

      <textarea
        value={draft.notes ?? ''}
        onChange={(e) => set('notes', e.target.value)}
        placeholder="notes (optional)"
        rows={2}
        style={{ ...TA_STYLE, fontFamily: T.sans }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <Button variant="tiny" onClick={onCancel} disabled={busy}>cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={!valid} busy={busy}>
          {busy ? '...' : 'save'}
        </Button>
      </div>
    </div>
  )
}
