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

// /intake — Brand intake.
//
// Core: one audience per location, autosave-on-blur form (existing flow).
// Pro:  many audiences per location. List view with [Add] / [Edit] / [Retire].
// Free: LockScreen.

type AnswerKey = keyof IcpInput

const QUESTIONS: { key: AnswerKey; label: string; example: string }[] = [
  { key: 'name',                label: 'What do you call them?',
    example: 'A short, human name for this customer — "morning regulars," "after-school students," "date-night couples."' },
  { key: 'ageRange',            label: 'How old are they, roughly?',
    example: 'A range is fine — 28–45, mid-30s, "older millennials"' },
  { key: 'location',            label: 'Where do they live or shop?',
    example: 'Neighborhood, city, region — wherever they spend their time' },
  { key: 'politicalSpectrum',   label: 'How do they lean, politically?',
    example: 'Just the basics — center, traditional, progressive. Only if it shapes their taste.' },
  { key: 'openness',            label: 'Are they explorers or creatures of habit?',
    example: 'Do they love discovering new things, or does familiar mean comfortable?' },
  { key: 'fears',               label: 'What are they quietly afraid of?',
    example: 'Irrelevance, aging out, looking like they\'re trying too hard — the social fears they\'d never name' },
  { key: 'values',              label: 'What matters to them?',
    example: 'A short list — craft, family, time outdoors, looking sharp' },
  { key: 'desires',             label: 'What are they here for?',
    example: 'The thing they\'d say if you asked them at the door' },
  { key: 'unexpressedDesires',  label: 'What do they want but won\'t admit?',
    example: 'The quieter motivation underneath the stated one' },
  { key: 'turnOffs',            label: 'What would make them leave?',
    example: 'Tone, words, music — anything that makes them feel out of place' },
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
          tabName="Customer Profile"
          valueLine="Music tailored to the people who actually walk into your store."
          requiredTier="core"
          currentTier={tier}
          timeToValue="Fill it in and your library starts being built around your audience — usually live on the floor within a few days."
          detail="Ten questions about who walks in. The answers become your own music library, built around your specific customer instead of the one every store starts on."
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
      .catch(() => { if (!cancelled) setError('Could not load your saved intake.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const update = (k: AnswerKey, v: string) =>
    setAnswers((a) => ({ ...a, [k]: v }))

  const dirty = (Object.keys(answers) as AnswerKey[]).some((k) => answers[k] !== loaded[k])

  const doSave = async (opts: { silent?: boolean } = {}) => {
    if (saveState.kind === 'saving') return
    if (!answers.name.trim()) {
      if (!opts.silent) setError('Audience name is required.')
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
        setError(e instanceof Error ? e.message : 'Save failed.')
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
        <Eyebrow>Your customer</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          Who walks into your store?
        </h1>
        {storeName && <LocationLabel name={storeName} />}
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '52ch',
        }}>
          Each answer changes the music. None of them are wrong, and you can
          come back and re-tune any time.
        </p>
        <SaveIndicator saveState={saveState} savedAt={savedAt} />
      </div>

      <div style={questionsBlockStyle}>
        {loading ? (
          <div style={{ color: T.textDim, fontSize: 14 }}>Loading…</div>
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
                    Reset
                  </Button>
                  <Button onClick={() => doSave()} disabled={!dirty || saveState.kind === 'saving'}>
                    {saveState.kind === 'saving' ? 'Saving…' : (savedAt ? 'Save changes' : 'Tune my music')}
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
      setError(e instanceof Error ? e.message : 'Could not load audiences.')
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
        <Eyebrow>Your audiences</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          Who walks in?
        </h1>
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '60ch',
        }}>
          A location can have a few different customers — morning
          regulars, after-school students, date-night couples. Each one
          shapes its own slice of the music library.
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
            `Retire ${icp.name}? Their songs will stop playing — they're not deleted, so we can restore them later.`,
          )
          if (!ok) return
          try {
            await api.retireIcp(icp.id)
            reload()
          } catch (e) {
            alert(`Retire failed: ${e instanceof Error ? e.message : 'unknown'}`)
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
        Location
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
    return <div style={{ color: T.textDim, fontSize: 14 }}>Loading…</div>
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
          No audiences yet for {storeName}. Add one and we'll start composing for them.
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
        <Plus size={14} strokeWidth={2} /> Add an audience
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
            {icp.songCount} song{icp.songCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <button onClick={onEdit} style={iconActionStyle} title="Edit audience">
        <Pencil size={13} strokeWidth={1.75} /> Edit
      </button>
      <button onClick={onRetire} style={iconActionStyle} title="Retire audience">
        <Archive size={13} strokeWidth={1.75} /> Retire
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
      setError('Persona name is required.')
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
      setError(e instanceof Error ? e.message : 'Save failed.')
      setBusy(false)
    }
  }

  const basicQs = QUESTIONS.filter((q) => BASIC_KEYS.includes(q.key))
  const extendedQs = QUESTIONS.filter((q) => !BASIC_KEYS.includes(q.key))

  return (
    <>
      <div style={{ marginBottom: 24, maxWidth: 640 }}>
        <Eyebrow>{mode === 'add' ? 'New audience' : 'Edit audience'}</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.6rem, 2.4vw, 2.1rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          {mode === 'add' ? 'Tell us about this persona' : `Editing ${icp?.name ?? 'audience'}`}
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
                <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
                <Button onClick={submit} disabled={busy}>
                  {busy ? 'Saving…' : (mode === 'add' ? 'Create audience' : 'Save changes')}
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
        Add more detail
        <span style={{
          color: T.textFaint, fontSize: 13, marginLeft: 10,
          fontWeight: 400,
        }}>
          Seven more questions — they sharpen the music
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
      <span>For: <span style={{ color: T.text }}>{name}</span></span>
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
        Saving…
      </div>
    )
  }
  if (saveState.kind === 'saved') {
    return (
      <div style={{
        marginTop: 18, fontSize: 12, color: T.accent,
        letterSpacing: '0.06em',
      }}>
        Saved just now
      </div>
    )
  }
  if (savedAt) {
    return (
      <div style={{
        marginTop: 18, fontSize: 12, color: T.textFaint,
        letterSpacing: '0.06em',
      }}>
        Saved {new Date(savedAt).toLocaleString()}
      </div>
    )
  }
  return null
}

function SuccessState() {
  return (
    <Layout>
      <div style={{ maxWidth: 640 }}>
        <Eyebrow>You're tuned in</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.9rem, 3vw, 2.7rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.08,
          color: T.text, margin: '0 0 12px',
        }}>
          Your music is being tuned.
        </h1>
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '52ch',
        }}>
          We'll start composing your library around these answers. New
          tracks usually land on your floor within a few days. You can
          come back and adjust any time — every change carries forward.
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
            What's next
          </div>
          <NextStepRow
            to="/locations"
            title="Add another location"
            sub="One subscription, multiple stores — billing is prorated."
          />
          <NextStepRow
            to="/"
            title="See what's playing"
            sub="Your home tab has the player URL — open it on any in-store device."
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
