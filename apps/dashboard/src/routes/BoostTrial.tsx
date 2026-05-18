import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { T } from '@entuned/tokens'
import { Logo } from '../ui/index.js'
import { CardChoice } from '../ui/CardChoice.js'
import { api, type BoostTrialInput } from '../api.js'
import { trackBoostTrialQuestionAnswered, trackBoostTrialStarted, trackBoostTrialCompleted } from '../lib/ga4.js'
import content from '../content/boost-trial.yaml'

// /boost-trial — self-serve ICP intake stepper for the Boost Trial.
// 6 forced-choice questions → POST /me/boost-trial → confirmation screen.

type QuestionDef = {
  id: string
  label: string
  options: { value: string; label: string }[]
}

const QUESTIONS = content.questions as QuestionDef[]

type Answers = Record<string, string>

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 32 }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= current ? T.accent : T.border,
            transition: 'background 0.2s ease',
          }}
        />
      ))}
    </div>
  )
}

export function BoostTrial() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const q = QUESTIONS[step]
  const total = QUESTIONS.length
  const currentAnswer = answers[q.id] ?? null

  const handleAnswer = (value: string) => {
    setAnswers((prev) => ({ ...prev, [q.id]: value }))
  }

  const handleNext = async () => {
    if (!currentAnswer) return
    trackBoostTrialQuestionAnswered(step + 1, q.id, currentAnswer)
    if (step < total - 1) {
      setStep((s) => s + 1)
      return
    }
    // Last step — submit.
    setError(null)
    setBusy(true)
    try {
      const body: BoostTrialInput = {
        icpAgeCenter: answers['icpAgeCenter'] ?? '',
        icpAgeRangeWide: answers['icpAgeRangeWide'] === 'true',
        icpGenderSkew: answers['icpGenderSkew'] ?? '',
        icpShoppingMode: answers['icpShoppingMode'] ?? '',
        icpStorePersonality: answers['icpStorePersonality'] ?? '',
        icpCurrentMusic: answers['icpCurrentMusic'] ?? '',
        icpCurrentMusicOther: answers['icpCurrentMusicOther'],
      }
      await api.startBoostTrial(body)
      trackBoostTrialCompleted()
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : content.error)
    } finally {
      setBusy(false)
    }
  }

  // Fire tracking on first render
  useState(() => { trackBoostTrialStarted() })

  if (done) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{
            fontSize: 40, marginBottom: 16,
          }}>🎵</div>
          <h1 style={{
            fontFamily: T.heading, fontSize: 22, fontWeight: 600,
            color: T.text, margin: '0 0 12px 0', letterSpacing: '-0.01em',
          }}>
            {content.confirm.heading}
          </h1>
          <p style={{
            color: T.textMuted, fontSize: 15, fontFamily: T.sans,
            lineHeight: 1.6, margin: '0 0 28px 0',
          }}>
            {content.confirm.body}
          </p>
          <button
            onClick={() => navigate('/', { replace: true })}
            style={{
              padding: '13px 28px',
              background: T.accent, border: 'none',
              borderRadius: 10, color: T.bg,
              fontFamily: T.sans, fontSize: 15, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {content.confirm.cta}
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <StepProgress current={step} total={total} />

      <p style={{
        color: T.textFaint, fontSize: 12, fontFamily: T.sans,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        margin: '0 0 16px 0',
      }}>
        {(content.step_counter as string)
          .replace('{{current}}', String(step + 1))
          .replace('{{total}}', String(total))}
      </p>

      <h2 style={{
        fontFamily: T.heading, fontSize: 20, fontWeight: 600,
        color: T.text, margin: '0 0 20px 0', letterSpacing: '-0.01em',
      }}>
        {q.label}
      </h2>

      <CardChoice
        options={q.options.map((o) => ({ id: o.value, label: o.label }))}
        value={currentAnswer}
        onChange={handleAnswer}
        columns={q.options.length <= 4 ? 2 : 2}
      />

      {error && (
        <div style={{
          color: T.danger, fontSize: 13, fontFamily: T.sans,
          marginTop: 16,
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginTop: 28, gap: 12,
      }}>
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            style={{
              padding: '10px 18px',
              background: 'transparent',
              border: `1px solid ${T.border}`,
              borderRadius: 10, color: T.textMuted,
              fontFamily: T.sans, fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {content.back}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={!currentAnswer || busy}
          onClick={handleNext}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 22px',
            background: currentAnswer && !busy ? T.accent : T.border,
            border: 'none', borderRadius: 10,
            color: currentAnswer && !busy ? T.bg : T.textFaint,
            fontFamily: T.sans, fontSize: 15, fontWeight: 600,
            cursor: currentAnswer && !busy ? 'pointer' : 'default',
            transition: 'background 0.15s ease',
          }}
        >
          {step < total - 1
            ? <>{content.next} <ArrowRight size={16} /></>
            : busy ? content.submit_busy : content.submit
          }
        </button>
      </div>
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <Logo />
        </div>
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, padding: '32px 32px',
        }}>
          {children}
        </div>
      </div>
    </div>
  )
}
