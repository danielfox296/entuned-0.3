import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { Button, Eyebrow, Input } from '../ui/index.js'
import { api, TIER_RANK, type IcpInput } from '../api.js'
import { useTier } from '../lib/tier.jsx'

// /intake — Brand intake form. Free users see LockScreen. Core+ see the form,
// which round-trips through GET/POST /me/icp.
type AnswerKey = keyof IcpInput

// Each question reads like something you'd actually ask a shop owner over
// coffee. The `example` line stays visible under the field (placeholder text
// disappears on focus, exactly when the user wants to see it most).
const QUESTIONS: { key: AnswerKey; label: string; example: string }[] = [
  { key: 'name',                label: 'What do you call them?',
    example: 'A nickname for this audience, e.g. "Park Meadows lunch crowd"' },
  { key: 'ageRange',            label: 'How old are they, roughly?',
    example: 'A range is fine — 28–45, mid-30s, "older millennials"' },
  { key: 'location',            label: 'Where do they live or shop?',
    example: 'Neighborhood, city, region — wherever they spend their time' },
  { key: 'values',              label: 'What matters to them?',
    example: 'A short list — craft, family, time outdoors, looking sharp' },
  { key: 'desires',             label: 'What are they here for?',
    example: 'The thing they’d say if you asked them at the door' },
  { key: 'unexpressedDesires',  label: 'What do they want but won’t admit?',
    example: 'The quieter motivation underneath the stated one' },
  { key: 'turnOffs',            label: 'What would make them leave?',
    example: 'Tone, words, music — anything that makes them feel out of place' },
]

// Progressive disclosure: show these three first, reveal the rest behind
// "Add more detail" so the form doesn't read as 7 mandatory questions.
const BASIC_KEYS: AnswerKey[] = ['name', 'ageRange', 'location']

type Answers = Record<AnswerKey, string>

const EMPTY_ANSWERS: Answers = {
  name: '', ageRange: '', location: '',
  values: '', desires: '', unexpressedDesires: '', turnOffs: '',
}

export function IcpIntake() {
  const { tier } = useTier()

  if (TIER_RANK[tier] < TIER_RANK.core) {
    return (
      <Layout>
        <LockScreen
          tabName="Brand Intake"
          valueLine="Music tailored to your specific customer, not the average shopper."
          requiredTier="core"
          currentTier={tier}
          timeToValue="Fill it in and your library starts being built around your audience — usually live on the floor within a few days."
          detail="Seven questions about who actually walks in. We turn those answers into a private music library that fits your audience — instead of falling back on the generic mood pool."
        />
      </Layout>
    )
  }

  return <IcpIntakeForm />
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }

function IcpIntakeForm() {
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
          const next: Answers = {
            name: r.icp.name ?? '',
            ageRange: r.icp.ageRange ?? '',
            location: r.icp.location ?? '',
            values: r.icp.values ?? '',
            desires: r.icp.desires ?? '',
            unexpressedDesires: r.icp.unexpressedDesires ?? '',
            turnOffs: r.icp.turnOffs ?? '',
          }
          setAnswers(next)
          setLoaded(next)
          setSavedAt(r.icp.updatedAt)
          // If any of the deeper questions already have answers, expand the
          // extended section so the user sees their previous work.
          const hasExtended = QUESTIONS
            .filter((q) => !BASIC_KEYS.includes(q.key))
            .some((q) => (next[q.key] ?? '').trim().length > 0)
          if (hasExtended) setShowExtended(true)
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
      // For autosave we never surface a "name required" — just skip.
      // For explicit save we show the error.
      if (!opts.silent) setError('Audience name is required.')
      return
    }
    setError(null)
    const wasFirstSave = !savedAt
    setSaveState({ kind: 'saving' })
    try {
      const payload: IcpInput = {
        name: answers.name.trim(),
        ageRange: answers.ageRange.trim() || null,
        location: answers.location.trim() || null,
        values: answers.values.trim() || null,
        desires: answers.desires.trim() || null,
        unexpressedDesires: answers.unexpressedDesires.trim() || null,
        turnOffs: answers.turnOffs.trim() || null,
      }
      const { icp } = await api.saveMeIcp(payload)
      const next: Answers = {
        name: icp.name ?? '',
        ageRange: icp.ageRange ?? '',
        location: icp.location ?? '',
        values: icp.values ?? '',
        desires: icp.desires ?? '',
        unexpressedDesires: icp.unexpressedDesires ?? '',
        turnOffs: icp.turnOffs ?? '',
      }
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

  // Autosave on blur if the field has a value and the form has changes.
  // Silent — no user-facing error if it fails (they can still hit Save).
  const onFieldBlur = (k: AnswerKey) => {
    if (!dirty) return
    if (k === 'name' && !answers.name.trim()) return
    doSave({ silent: true })
  }

  if (showSuccess) {
    return <SuccessState />
  }

  const renderQuestion = (q: { key: AnswerKey; label: string; example: string }) => (
    <div key={q.key}>
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
        value={answers[q.key]}
        onChange={(e) => update(q.key, e.target.value)}
        onBlur={() => onFieldBlur(q.key)}
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

  const basicQs = QUESTIONS.filter((q) => BASIC_KEYS.includes(q.key))
  const extendedQs = QUESTIONS.filter((q) => !BASIC_KEYS.includes(q.key))

  return (
    <Layout>
      <div style={{ marginBottom: 32, maxWidth: 640 }}>
        <Eyebrow>Brand voice</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          Who walks into your store?
        </h1>
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '52ch',
        }}>
          Each answer changes the music. None of them are wrong, and you can
          come back and re-tune any time.
        </p>
        <SaveIndicator saveState={saveState} savedAt={savedAt} />
      </div>

      <div style={{
        background: 'transparent',
        borderLeft: `3px solid ${T.accent}`,
        paddingLeft: 24,
        maxWidth: 720,
      }}>
        {loading ? (
          <div style={{ color: T.textDim, fontSize: 14 }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gap: 28 }}>
            {basicQs.map(renderQuestion)}

            {!showExtended && (
              <button
                type="button"
                onClick={() => setShowExtended(true)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.border}`,
                  color: T.accent,
                  padding: '12px 16px',
                  borderRadius: 4,
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
                    Four more questions — they sharpen the music
                  </span>
                </span>
                <ArrowRight size={16} strokeWidth={1.75} />
              </button>
            )}

            {showExtended && extendedQs.map(renderQuestion)}

            {error && (
              <div style={{ color: T.danger, fontSize: 13 }}>{error}</div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              gap: 12, alignItems: 'center',
              borderTop: `1px solid ${T.borderSubtle}`,
              paddingTop: 20, marginTop: 8,
            }}>
              <Button variant="ghost" onClick={() => setAnswers(loaded)} disabled={!dirty || saveState.kind === 'saving'}>
                Reset
              </Button>
              <Button onClick={() => doSave()} disabled={!dirty || saveState.kind === 'saving'}>
                {saveState.kind === 'saving' ? 'Saving…' : (savedAt ? 'Save changes' : 'Tune my music')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

// Live save indicator under the headline. Switches between the persistent
// "saved at" timestamp and a transient "Saved just now" flash on autosave.
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

// Shown after the very first save completes successfully. Marks the high
// moment instead of leaving the user staring at a "Saved 3:42 PM" timestamp.
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
          borderRadius: 6,
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
      borderRadius: 4,
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
