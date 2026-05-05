import { useEffect, useState } from 'react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { LockScreen } from '../ui/LockScreen.js'
import { Button, Eyebrow, Input } from '../ui/index.js'
import { api, TIER_RANK, type IcpInput } from '../api.js'
import { useTier } from '../lib/tier.jsx'

// /intake — Brand intake form. Free users see LockScreen. Core+ see the form,
// which round-trips through GET/POST /me/icp.
type AnswerKey = keyof IcpInput

const QUESTIONS: { key: AnswerKey; label: string; hint: string }[] = [
  { key: 'name',                label: 'Audience name',          hint: 'e.g. "Park Meadows lunch crowd"' },
  { key: 'ageRange',            label: 'Age range',              hint: 'e.g. 28–45' },
  { key: 'location',            label: 'Where they live / shop', hint: 'City, region, or neighborhood' },
  { key: 'values',              label: 'What they value',        hint: 'A short list — comma separated' },
  { key: 'desires',             label: 'What they want',         hint: 'Stated goals' },
  { key: 'unexpressedDesires',  label: 'What they would not say out loud', hint: 'The quieter motivations' },
  { key: 'turnOffs',            label: 'What turns them off',    hint: 'Tone, words, or styles to avoid' },
]

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
          detail="Seven questions about who actually walks in. We turn those answers into a private music library that fits your audience — instead of falling back on the generic mood pool."
        />
      </Layout>
    )
  }

  return <IcpIntakeForm />
}

function IcpIntakeForm() {
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS)
  const [loaded, setLoaded] = useState<Answers>(EMPTY_ANSWERS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        }
      })
      .catch(() => { if (!cancelled) setError('Could not load your saved intake.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const update = (k: AnswerKey, v: string) =>
    setAnswers((a) => ({ ...a, [k]: v }))

  const dirty = (Object.keys(answers) as AnswerKey[]).some((k) => answers[k] !== loaded[k])

  const save = async () => {
    if (saving) return
    setError(null)
    if (!answers.name.trim()) {
      setError('Audience name is required.')
      return
    }
    setSaving(true)
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout>
      <div style={{ marginBottom: 32, maxWidth: 640 }}>
        <Eyebrow>Brand voice · Intake</Eyebrow>
        <h1 style={{
          fontFamily: T.heading,
          fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)',
          fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1,
          color: T.text, margin: '0 0 12px',
        }}>
          Tell us about your audience.
        </h1>
        <p style={{
          fontSize: 15, lineHeight: 1.55,
          color: T.textDim, margin: 0, maxWidth: '52ch',
        }}>
          Seven questions, two minutes. Each answer shapes the music we write
          for your floor — you can re-tune any time.
        </p>
        {savedAt && (
          <div style={{
            marginTop: 18, fontSize: 12, color: T.textFaint,
            letterSpacing: '0.06em',
          }}>
            Saved {new Date(savedAt).toLocaleString()}
          </div>
        )}
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
            {QUESTIONS.map((q) => (
              <div key={q.key}>
                <Eyebrow>{q.label}</Eyebrow>
                <Input
                  value={answers[q.key]}
                  onChange={(e) => update(q.key, e.target.value)}
                  placeholder={q.hint}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `1px solid ${T.border}`,
                    borderRadius: 0,
                    fontSize: 17,
                    padding: '8px 0',
                  }}
                />
              </div>
            ))}

            {error && (
              <div style={{ color: T.danger, fontSize: 13 }}>{error}</div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              gap: 12, alignItems: 'center',
              borderTop: `1px solid ${T.borderSubtle}`,
              paddingTop: 20, marginTop: 8,
            }}>
              <Button variant="ghost" onClick={() => setAnswers(loaded)} disabled={!dirty || saving}>
                Reset
              </Button>
              <Button onClick={save} disabled={!dirty || saving}>
                {saving ? 'Saving…' : (savedAt ? 'Save changes' : 'Save and continue')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
