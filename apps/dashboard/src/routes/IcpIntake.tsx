import { useState } from 'react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card } from '../ui/Card.js'
import { Button, Input } from '../ui/index.js'

// /intake — first-run brand intake. Seven Core questions, placeholder until
// the real wizard UI lands. Field labels mirror the IcpRow shape from the
// admin app's api.ts so the eventual server payload is straightforward.
const QUESTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'name',                label: 'Audience name',          hint: 'e.g. "Park Meadows lunch crowd"' },
  { key: 'ageRange',            label: 'Age range',              hint: 'e.g. 28–45' },
  { key: 'location',            label: 'Where they live / shop', hint: 'City, region, or neighborhood' },
  { key: 'values',              label: 'What they value',        hint: 'A short list — comma separated' },
  { key: 'desires',             label: 'What they want',         hint: 'Stated goals' },
  { key: 'unexpressedDesires',  label: 'What they would not say out loud', hint: 'The quieter motivations' },
  { key: 'turnOffs',            label: 'What turns them off',    hint: 'Tone, words, or styles to avoid' },
]

export function IcpIntake() {
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const update = (k: string, v: string) =>
    setAnswers((a) => ({ ...a, [k]: v }))

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: T.heading, fontSize: 24, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em',
        }}>Tell us about your audience</h1>
        <div style={{ color: T.textDim, fontSize: 14, marginTop: 4 }}>
          Seven questions. Two minutes. Drives every song we write for you.
        </div>
      </div>

      <Card>
        <div style={{ display: 'grid', gap: 18 }}>
          {QUESTIONS.map((q) => (
            <div key={q.key}>
              <label style={{
                display: 'block', fontSize: 13, color: T.textMuted,
                marginBottom: 6, fontFamily: T.sans,
              }}>
                {q.label}
              </label>
              <Input
                value={answers[q.key] ?? ''}
                onChange={(e) => update(q.key, e.target.value)}
                placeholder={q.hint}
              />
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Button variant="ghost" onClick={() => setAnswers({})}>Reset</Button>
            <Button onClick={() => { /* wired in later phase */ }}>
              Save and continue
            </Button>
          </div>
        </div>
      </Card>
    </Layout>
  )
}
