import { useState } from 'react'
import { T } from '../tokens.js'
import { Button, Eyebrow, Input } from '../ui/index.js'
import { api } from '../api.js'

// /start — magic-link request + Google OAuth entry. Customer-facing login.
// No password field by design: passwordless via magic link.
//
// Layout pulled from the PLG onboarding design: full-bleed dark canvas,
// eyebrow + Manrope headline + muted sub, primary CTA below the field,
// Google as secondary path under a hairline divider.
export function Start() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.requestMagicLink(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <Eyebrow>Step 01 · Account</Eyebrow>
      <Headline>Let's tune your store.</Headline>

      {sent ? (
        <>
          <Sub>
            Check <span style={{ color: T.text }}>{email}</span>. The link
            opens your dashboard — no password to remember.
          </Sub>
          <div style={{
            marginTop: 24,
            padding: '16px 18px',
            background: T.accentGlow,
            borderLeft: `3px solid ${T.accent}`,
            color: T.textMuted,
            fontSize: 14,
            lineHeight: 1.55,
          }}>
            Didn't land? Check spam, or send another to a different address.
          </div>
        </>
      ) : (
        <>
          <Sub>
            One thing to start. We email a sign-in link the moment you finish
            — no password to remember.
          </Sub>

          <form onSubmit={submit} style={{ display: 'grid', gap: 18, marginTop: 28 }}>
            <div>
              <Eyebrow>Work email</Eyebrow>
              <BigInput
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourstore.com"
                autoFocus
              />
            </div>

            {error && (
              <div style={{ fontSize: 13, color: T.danger }}>{error}</div>
            )}

            <div style={{ marginTop: 4 }}>
              <Button type="submit" busy={busy}>
                {busy ? 'Sending…' : 'Email me a sign-in link'}
              </Button>
            </div>
          </form>

          <Divider />

          <a
            href={api.googleLoginUrl()}
            style={{
              display: 'block',
              background: 'transparent',
              border: `1px solid ${T.border}`,
              borderRadius: 4,
              padding: '11px 14px',
              fontSize: 14,
              color: T.text,
              textAlign: 'center',
              textDecoration: 'none',
              fontFamily: T.sans,
            }}
          >
            Continue with Google
          </a>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.sans, padding: 24, color: T.text,
    }}>
      <div style={{ width: 460, maxWidth: '100%' }}>
        <div style={{
          fontFamily: T.heading, fontSize: 22, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', marginBottom: 40,
        }}>entuned</div>
        {children}
      </div>
    </div>
  )
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1 style={{
      fontFamily: T.heading, fontWeight: 600,
      fontSize: 'clamp(1.9rem, 3vw, 2.7rem)',
      letterSpacing: '-0.015em', lineHeight: 1.08,
      color: T.text, margin: '0 0 12px', maxWidth: '20ch',
    }}>
      {children}
    </h1>
  )
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 15, lineHeight: 1.55,
      color: T.textDim, margin: 0, maxWidth: '46ch',
    }}>
      {children}
    </p>
  )
}

function BigInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Input
      {...props}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${T.border}`,
        borderRadius: 0,
        fontFamily: T.heading,
        fontSize: 24,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        padding: '8px 0',
      }}
    />
  )
}

function Divider() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '28px 0 20px',
      color: T.textFaint, fontSize: 12,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
      or
      <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
    </div>
  )
}
