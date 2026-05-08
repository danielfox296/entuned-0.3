import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, Pencil, Archive, MapPin } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { Button, Eyebrow, Input } from '../ui/index.js'
import {
  api, primaryStore, TIER_RANK,
  type IcpInput, type IcpListRow, type IcpRow, type StoreRow,
} from '../api.js'
import { useTier } from '../lib/tier.jsx'
import content from '../content/icp-intake.yaml'

// /intake — Brand intake.
//
// Core: one audience per location, autosave-on-blur form (existing flow).
// Pro:  many audiences per location. List view with [Add] / [Edit] / [Retire].
// Free: LockScreen.

type AnswerKey = keyof IcpInput

const QUESTIONS: { key: AnswerKey; label: string; example: string }[] = [
  { key: 'name',                label: content.questions.name.label,                example: content.questions.name.example },
  { key: 'ageRange',            label: content.questions.age_range.label,           example: content.questions.age_range.example },
  { key: 'location',            label: content.questions.location.label,            example: content.questions.location.example },
  { key: 'politicalSpectrum',   label: content.questions.political_spectrum.label,  example: content.questions.political_spectrum.example },
  { key: 'openness',            label: content.questions.openness.label,            example: content.questions.openness.example },
  { key: 'fears',               label: content.questions.fears.label,               example: content.questions.fears.example },
  { key: 'values',              label: content.questions.values.label,              example: content.questions.values.example },
  { key: 'desires',             label: content.questions.desires.label,             example: content.questions.desires.example },
  { key: 'unexpressedDesires',  label: content.questions.unexpressed_desires.label, example: content.questions.unexpressed_desires.example },
  { key: 'turnOffs',            label: content.questions.turn_offs.label,           example: content.questions.turn_offs.example },
]

const BASIC_KEYS: AnswerKey[] = ['name', 'ageRange', 'location']

type Answers = Record<AnswerKey, string>

const EMPTY_ANSWERS: Answers = {
  name: '', ageRange: '', location: '',
  politicalSpectrum: '', openness: '', fears: '',
  values: '', desires: '', unexpressedDesires: '', turnOffs: '',
}

function answersFromIcp(icp: IcpRow): Answers {
  return {
    name: icp.name ?? '',
    ageRange: icp.ageRange ?? '',
    location: icp.location ?? '',
    politicalSpectrum: icp.politicalSpectrum ?? '',
    openness: icp.openness ?? '',
    fears: icp.fears ?? '',
    values: icp.values ?? '',
    desires: icp.desires ?? '',
    unexpressedDesires: icp.unexpressedDesires ?? '',
    turnOffs: icp.turnOffs ?? '',
  }
}

function inputFromAnswers(a: Answers): IcpInput {
  return {
    name: a.name.trim(),
    ageRange: a.ageRange.trim() || null,
    location: a.location.trim() || null,
    politicalSpectrum: a.politicalSpectrum.trim() || null,
    openness: a.openness.trim() || null,
    fears: a.fears.trim() || null,
    values: a.values.trim() || null,
    desires: a.desires.trim() || null,
    unexpressedDesires: a.unexpressedDesires.trim() || null,
    turnOffs: a.turnOffs.trim() || null,
  }
}

function hasExtendedFilled(a: Answers): boolean {
  return QUESTIONS
    .filter((q) => !BASIC_KEYS.includes(q.key))
    .some((q) => (a[q.key] ?? '').trim().length > 0)
}

export function IcpIntake() {
  const { stores, tier } = useTier()

  if (TIER_RANK[tier] < TIER_RANK.core) {
    return (
      <Layout>
        <LockScreen
          tabName={content.lock.tab_name}
          valueLine={content.lock.value_line}
          requiredTier="core"
          currentTier={tier}
          timeToValue={content.lock.time_to_value}
          detail={content.lock.detail}
        />
      </Layout>
    )
  }

  if (TIER_RANK[tier] >= TIER_RANK.pro) {
    return <ProIcpIntake stores={stores} />
  }

  return <CoreIcpIntake stores={stores} />
}

// ─── Core ───────────────────────────────────────────────────────────────────

function CoreIcpIntake({ stores }: { stores: StoreRow[] }) {
  const primary = primaryStore(stores)
  return <IcpIntakeForm storeName={primary?.name ?? null} />
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }

function IcpIntakeForm({ storeName }: { storeName: string | null }) {
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS)
  const [loaded, setLoaded] = useState<Answers>(EMPTY_ANSWERS)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showExtended, setShowExtended] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.meIcp()
      .then((r) => {
        if (cancelled) return
        if (r.icp) {
          const next = answersFromIcp(r.icp)
          setAnswers(next)
          setLoaded(next)
          setSavedAt(r.icp.updatedAt)
          if (hasExtendedFilled(next)) setShowExtended(true)
        }
      })
      .catch(() => { if (!cancelled) setError(content.core.load_failed) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const update = (k: AnswerKey, v: string) =>
    setAnswers((a) => ({ ...a, [k]: v }))

  const dirty = (Object.keys(answers) as AnswerKey[]).some((k) => answers[k] !== loaded[k])

  const doSave = async (opts: { silent?: boolean } = {}) => {
    if (saveState.kind === 'saving') return
    if (!answers.name.trim()) {
      if (!opts.silent) setError(content.core.name_required)
      return
    }
    setError(null)
    const wasFirstSave = !savedAt
    setSaveState({ kind: 'saving' })
    try {
      const { icp } = await api.saveMeIcp(inputFromAnswers(answers))
      const next = answersFromIcp(icp)
      setAnswers(next)
      setLoaded(next)
      setSavedAt(icp.updatedAt)
      setSaveState({ kind: 'saved', at: Date.now() })
      if (wasFirstSave && !opts.silent) {
        setShowSuccess(true)
      }
    } catch (e) {
      if (!opts.silent) {
        setError(e instanceof Error ? e.message : content.core.save_failed)
      }
      setSaveState({ kind: 'idle' })
    }
  }

  const onFieldBlur = (k: AnswerKey) => {
    if (!dirty) return
    if (k === 'name' && !answers.name.trim()) return
    doSave({ silent: true })
  }

  if (showSuccess) return <SuccessState />

  const basicQs = QUESTIONS.filter((q) => BASIC_KEYS.includes(q.key))
  const extendedQs = QUESTIONS.filter((q) => !BASIC_KEYS.includes(q.key))

  return (
    <Layout>
      <div style={{ marginBottom: 32, maxWidth: 640 }}>
        <Eyebrow>{content.core.eyebrow}</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          {content.core.headline}
        </h1>
        {storeName && <LocationLabel name={storeName} />}
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '52ch',
        }}>
          {content.core.intro}
        </p>
        <SaveIndicator saveState={saveState} savedAt={savedAt} />
      </div>

      <div style={questionsBlockStyle}>
        {loading ? (
          <div style={{ color: T.textDim, fontSize: 14 }}>{content.core.loading}</div>
        ) : (
          <div style={{ display: 'grid', gap: 28 }}>
            {basicQs.map((q) => (
              <QuestionField
                key={q.key} q={q}
                value={answers[q.key]}
                onChange={(v) => update(q.key, v)}
                onBlur={() => onFieldBlur(q.key)}
              />
            ))}

            {!showExtended && (
              <ExpandExtendedButton onClick={() => setShowExtended(true)} />
            )}
            {showExtended && extendedQs.map((q) => (
              <QuestionField
                key={q.key} q={q}
                value={answers[q.key]}
                onChange={(v) => update(q.key, v)}
                onBlur={() => onFieldBlur(q.key)}
              />
            ))}

            {error && <ErrorRow message={error} />}

            <FormActions
              right={
                <>
                  <Button variant="ghost" onClick={() => setAnswers(loaded)} disabled={!dirty || saveState.kind === 'saving'}>
                    {content.core.reset}
                  </Button>
                  <Button onClick={() => doSave()} disabled={!dirty || saveState.kind === 'saving'}>
                    {saveState.kind === 'saving' ? content.core.saving : (savedAt ? content.core.save_changes : content.core.tune_my_music)}
                  </Button>
                </>
              }
            />
          </div>
        )}
      </div>
    </Layout>
  )
}

// ─── Pro ────────────────────────────────────────────────────────────────────

function ProIcpIntake({ stores }: { stores: StoreRow[] }) {
  const initial = primaryStore(stores) ?? stores[0]
  const [selectedStoreId, setSelectedStoreId] = useState<string>(initial?.id ?? '')
  const [editing, setEditing] = useState<
    | { mode: 'add' }
    | { mode: 'edit'; icp: IcpListRow }
    | null
  >(null)
  const [audiences, setAudiences] = useState<IcpListRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    if (!selectedStoreId) return
    setLoading(true)
    try {
      const r = await api.meStoreIcps(selectedStoreId)
      setAudiences(r.icps)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : content.pro.load_failed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [selectedStoreId])

  const selectedStoreName = stores.find((s) => s.id === selectedStoreId)?.name ?? ''

  if (editing) {
    return (
      <Layout>
        <AudienceEditor
          mode={editing.mode}
          storeId={selectedStoreId}
          storeName={selectedStoreName}
          icp={editing.mode === 'edit' ? editing.icp : null}
          onDone={() => { setEditing(null); reload() }}
          onCancel={() => setEditing(null)}
        />
      </Layout>
    )
  }

  return (
    <Layout>
      <div style={{ marginBottom: 24, maxWidth: 760 }}>
        <Eyebrow>{content.pro.eyebrow}</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          {content.pro.headline}
        </h1>
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '60ch',
        }}>
          {content.pro.intro}
        </p>
      </div>

      {stores.length > 1 && (
        <LocationPicker
          stores={stores}
          value={selectedStoreId}
          onChange={setSelectedStoreId}
        />
      )}

      <AudiencesList
        audiences={audiences}
        loading={loading}
        error={error}
        storeName={selectedStoreName}
        onAdd={() => setEditing({ mode: 'add' })}
        onEdit={(icp) => setEditing({ mode: 'edit', icp })}
        onRetire={async (icp) => {
          const ok = window.confirm(
            `${content.pro.retire_confirm_prefix}${icp.name}${content.pro.retire_confirm_suffix}`,
          )
          if (!ok) return
          try {
            await api.retireIcp(icp.id)
            reload()
          } catch (e) {
            alert(`${content.pro.retire_failed_prefix}${e instanceof Error ? e.message : content.pro.retire_failed_unknown}`)
          }
        }}
      />
    </Layout>
  )
}

function LocationPicker({ stores, value, onChange }: {
  stores: StoreRow[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      marginBottom: 24,
    }}>
      <label style={{ fontSize: 13, color: T.textMuted, fontFamily: T.sans }}>
        {content.pro.location_label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: T.surfaceRaised,
          border: `1px solid ${T.border}`,
          color: T.text,
          fontFamily: T.sans, fontSize: 14,
          padding: '6px 10px', borderRadius: 10,
          cursor: 'pointer',
        }}
      >
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  )
}

function AudiencesList({
  audiences, loading, error, storeName,
  onAdd, onEdit, onRetire,
}: {
  audiences: IcpListRow[] | null
  loading: boolean
  error: string | null
  storeName: string
  onAdd: () => void
  onEdit: (icp: IcpListRow) => void
  onRetire: (icp: IcpListRow) => void
}) {
  if (loading && audiences === null) {
    return <div style={{ color: T.textDim, fontSize: 14 }}>{content.core.loading}</div>
  }
  if (error) return <ErrorRow message={error} />

  return (
    <div style={{ maxWidth: 760, display: 'grid', gap: 12 }}>
      {(audiences ?? []).length === 0 ? (
        <div style={{
          border: `1px dashed ${T.border}`,
          borderRadius: 12, padding: 24,
          color: T.textDim, fontSize: 14, lineHeight: 1.5,
          fontFamily: T.sans,
        }}>
          {content.pro.empty_prefix}{storeName}{content.pro.empty_suffix}
        </div>
      ) : (
        (audiences ?? []).map((icp) => (
          <AudienceCard
            key={icp.id} icp={icp}
            onEdit={() => onEdit(icp)}
            onRetire={() => onRetire(icp)}
          />
        ))
      )}

      <button
        type="button"
        onClick={onAdd}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'transparent',
          border: `1px solid ${T.border}`,
          color: T.accent,
          padding: '12px 16px', borderRadius: 10,
          fontFamily: T.sans, fontSize: 14, fontWeight: 500,
          cursor: 'pointer',
          alignSelf: 'flex-start',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.borderActive }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border }}
      >
        <Plus size={14} strokeWidth={2} /> {content.pro.add_audience}
      </button>
    </div>
  )
}

function AudienceCard({ icp, onEdit, onRetire }: {
  icp: IcpListRow
  onEdit: () => void
  onRetire: () => void
}) {
  const subline = [icp.ageRange, icp.location].filter(Boolean).join(' · ')

  return (
    <div style={{
      background: T.surfaceRaised,
      border: `1px solid ${T.border}`,
      borderRadius: 12, padding: 18,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: T.heading, fontSize: 17, fontWeight: 600,
          color: T.text, letterSpacing: '-0.01em',
        }}>
          {icp.name}
        </div>
        <div style={{
          fontSize: 13, color: T.textDim, marginTop: 4,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          {subline && <span>{subline}</span>}
          {subline && <span style={{ color: T.textFaint }}>·</span>}
          <span style={{ color: T.textMuted }}>
            {icp.songCount}{icp.songCount === 1 ? content.pro.song_singular : content.pro.song_plural}
          </span>
        </div>
      </div>
      <button onClick={onEdit} style={iconActionStyle} title={content.pro.edit_title}>
        <Pencil size={13} strokeWidth={1.75} /> {content.pro.edit}
      </button>
      <button onClick={onRetire} style={iconActionStyle} title={content.pro.retire_title}>
        <Archive size={13} strokeWidth={1.75} /> {content.pro.retire}
      </button>
    </div>
  )
}

function AudienceEditor({
  mode, storeId, storeName, icp, onDone, onCancel,
}: {
  mode: 'add' | 'edit'
  storeId: string
  storeName: string
  icp: IcpListRow | null
  onDone: () => void
  onCancel: () => void
}) {
  const [answers, setAnswers] = useState<Answers>(
    icp ? answersFromIcp(icp) : EMPTY_ANSWERS,
  )
  const [showExtended, setShowExtended] = useState<boolean>(
    icp ? hasExtendedFilled(answersFromIcp(icp)) : false,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (k: AnswerKey, v: string) =>
    setAnswers((a) => ({ ...a, [k]: v }))

  const submit = async () => {
    if (busy) return
    if (!answers.name.trim()) {
      setError(content.editor.name_required)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = inputFromAnswers(answers)
      if (mode === 'add') {
        await api.createIcp(storeId, payload)
      } else if (icp) {
        await api.updateIcp(icp.id, payload)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : content.editor.save_failed)
      setBusy(false)
    }
  }

  const basicQs = QUESTIONS.filter((q) => BASIC_KEYS.includes(q.key))
  const extendedQs = QUESTIONS.filter((q) => !BASIC_KEYS.includes(q.key))

  return (
    <>
      <div style={{ marginBottom: 24, maxWidth: 640 }}>
        <Eyebrow>{mode === 'add' ? content.editor.eyebrow_add : content.editor.eyebrow_edit}</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.6rem, 2.4vw, 2.1rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          {mode === 'add' ? content.editor.headline_add : `${content.editor.headline_edit_prefix}${icp?.name ?? content.editor.headline_edit_fallback}`}
        </h1>
        <LocationLabel name={storeName} />
      </div>

      <div style={questionsBlockStyle}>
        <div style={{ display: 'grid', gap: 28 }}>
          {basicQs.map((q) => (
            <QuestionField
              key={q.key} q={q}
              value={answers[q.key]}
              onChange={(v) => update(q.key, v)}
            />
          ))}

          {!showExtended && (
            <ExpandExtendedButton onClick={() => setShowExtended(true)} />
          )}
          {showExtended && extendedQs.map((q) => (
            <QuestionField
              key={q.key} q={q}
              value={answers[q.key]}
              onChange={(v) => update(q.key, v)}
            />
          ))}

          {error && <ErrorRow message={error} />}

          <FormActions
            right={
              <>
                <Button variant="ghost" onClick={onCancel} disabled={busy}>{content.editor.cancel}</Button>
                <Button onClick={submit} disabled={busy}>
                  {busy ? content.editor.saving : (mode === 'add' ? content.editor.create : content.editor.save)}
                </Button>
              </>
            }
          />
        </div>
      </div>
    </>
  )
}

// ─── Shared UI bits ─────────────────────────────────────────────────────────

function QuestionField({ q, value, onChange, onBlur }: {
  q: { key: AnswerKey; label: string; example: string }
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
}) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontFamily: T.heading,
        fontSize: 18, fontWeight: 600,
        color: T.text, letterSpacing: '-0.01em',
        marginBottom: 6,
      }}>
        {q.label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${T.border}`,
          borderRadius: 0,
          fontSize: 17,
          padding: '8px 0',
        }}
      />
      <div style={{
        marginTop: 6,
        fontSize: 13, color: T.textFaint, lineHeight: 1.5,
      }}>
        {q.example}
      </div>
    </div>
  )
}

function ExpandExtendedButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px solid ${T.border}`,
        color: T.accent,
        padding: '12px 16px',
        borderRadius: 10,
        fontFamily: T.sans, fontSize: 14, fontWeight: 500,
        cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 12,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.borderActive }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border }}
    >
      <span>
        {content.expand.label}
        <span style={{
          color: T.textFaint, fontSize: 13, marginLeft: 10,
          fontWeight: 400,
        }}>
          {content.expand.hint}
        </span>
      </span>
      <ArrowRight size={16} strokeWidth={1.75} />
    </button>
  )
}

function FormActions({ right }: { right: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'flex-end',
      gap: 12, alignItems: 'center',
      borderTop: `1px solid ${T.borderSubtle}`,
      paddingTop: 20, marginTop: 8,
    }}>
      {right}
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return <div style={{ color: T.danger, fontSize: 13 }}>{message}</div>
}

function LocationLabel({ name }: { name: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      color: T.textMuted, fontSize: 13, fontFamily: T.sans,
      marginBottom: 14,
    }}>
      <MapPin size={13} strokeWidth={1.75} />
      <span>{content.location_label_prefix}<span style={{ color: T.text }}>{name}</span></span>
    </div>
  )
}

function SaveIndicator({ saveState, savedAt }: { saveState: SaveState; savedAt: string | null }) {
  if (saveState.kind === 'saving') {
    return (
      <div style={{
        marginTop: 18, fontSize: 12, color: T.textFaint,
        letterSpacing: '0.06em',
      }}>
        {content.save_indicator.saving}
      </div>
    )
  }
  if (saveState.kind === 'saved') {
    return (
      <div style={{
        marginTop: 18, fontSize: 12, color: T.accent,
        letterSpacing: '0.06em',
      }}>
        {content.save_indicator.saved_just_now}
      </div>
    )
  }
  if (savedAt) {
    return (
      <div style={{
        marginTop: 18, fontSize: 12, color: T.textFaint,
        letterSpacing: '0.06em',
      }}>
        {content.save_indicator.saved_at_prefix}{new Date(savedAt).toLocaleString()}
      </div>
    )
  }
  return null
}

function SuccessState() {
  return (
    <Layout>
      <div style={{ maxWidth: 640 }}>
        <Eyebrow>{content.success.eyebrow}</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.9rem, 3vw, 2.7rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.08,
          color: T.text, margin: '0 0 12px',
        }}>
          {content.success.headline}
        </h1>
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '52ch',
        }}>
          {content.success.body}
        </p>

        <div style={{
          marginTop: 32,
          padding: 24,
          background: T.surfaceRaised,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          display: 'grid', gap: 16,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 500, letterSpacing: '0.18em',
            color: T.accent, textTransform: 'uppercase',
          }}>
            {content.success.next_eyebrow}
          </div>
          <NextStepRow
            to="/locations"
            title={content.success.next_add_location_title}
            sub={content.success.next_add_location_sub}
          />
          <NextStepRow
            to="/"
            title={content.success.next_see_playing_title}
            sub={content.success.next_see_playing_sub}
          />
        </div>
      </div>
    </Layout>
  )
}

function NextStepRow({ to, title, sub }: { to: string; title: string; sub: string }) {
  return (
    <Link to={to} style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '12px 14px',
      background: 'transparent',
      border: `1px solid ${T.borderSubtle}`,
      borderRadius: 10,
      textDecoration: 'none',
      color: T.text,
      transition: 'border-color 0.15s ease',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.borderActive }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.borderSubtle }}
    >
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: T.heading, fontSize: 16, fontWeight: 500,
          color: T.text, letterSpacing: '-0.01em', marginBottom: 4,
        }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.5 }}>
          {sub}
        </div>
      </div>
      <ArrowRight size={16} strokeWidth={1.75} color={T.accent} />
    </Link>
  )
}

const questionsBlockStyle: CSSProperties = {
  background: 'transparent',
  borderLeft: `3px solid ${T.accent}`,
  paddingLeft: 24,
  maxWidth: 720,
}

const iconActionStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'transparent', border: `1px solid ${T.border}`,
  color: T.textMuted, padding: '6px 12px', borderRadius: 8,
  fontFamily: T.sans, fontSize: 13, cursor: 'pointer',
}
