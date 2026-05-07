import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { T } from '../tokens.js'
import { Button, Eyebrow, Input, Logo } from '../ui/index.js'
import { api } from '../api.js'

export function Start() {
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next') ?? undefined
  const errorParam = searchParams.get('error')

  const linkErrorCopy = (() => {
    if (!errorParam) return null
    if (errorParam === 'token_expired') return 'That sign-in link expired. Send a new one — they only last 15 minutes.'
    if (errorParam === 'token_already_used') return 'That sign-in link was already used. Send a new one.'
    if (errorParam === 'invalid_token' || errorParam === 'missing_token') return "We couldn't read that sign-in link. Send a new one — sometimes copy-paste from email mangles the URL."
    return 'Sign-in link didn\'t work. Send a new one below.'
  })()

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.requestMagicLink(email, next)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(rgba(20,20,18,0.72), rgba(20,20,18,0.88)), url('/hero-start.jpg')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.sans,
      padding: 24,
      color: T.text,
    }}>
      <div className="start-grid" style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 64,
        maxWidth: 1040,
        width: '100%',
        alignItems: 'center',
      }}>

        {/* LEFT — value prop */}
        <div>
          <div style={{ marginBottom: 32 }}>
            <Logo />
          </div>
          <h1 style={{
            fontFamily: T.heading,
            fontWeight: 700,
            fontSize: 'clamp(2.4rem, 4vw, 3.6rem)',
            letterSpacing: '-0.02em',
            lineHeight: 1.08,
            color: T.text,
            margin: '0 0 20px',
            maxWidth: '18ch',
          }}>
            Music engineered for your store.
          </h1>
          <p style={{
            fontSize: 17,
            lineHeight: 1.6,
            color: T.textDim,
            margin: '0 0 28px',
            maxWidth: '38ch',
          }}>
            Original, retail-licensed music tuned to
            the people who walk into your store. Free forever,
            no card, plays through your existing speakers.
          </p>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            fontSize: 14,
            color: T.textMuted,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: T.accent, flexShrink: 0 }}>→</span>
              <span>PRO-indemnified from day one — no ASCAP, BMI, SESAC</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: T.accent, flexShrink: 0 }}>→</span>
              <span>Pick Linger or Lift Energy — outcome-designed for your floor</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: T.accent, flexShrink: 0 }}>→</span>
              <span>No app to install — plays from a URL on any device</span>
            </div>
          </div>
        </div>

        {/* RIGHT — auth */}
        <div style={{
          background: 'rgba(32,32,28,0.85)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: '40px 36px',
        }}>
          {sent ? (
            <>
              <AuthHeadline>Check your inbox.</AuthHeadline>
              <p style={{ fontSize: 15, lineHeight: 1.55, color: T.textDim, margin: '0 0 20px' }}>
                We sent a sign-in link to{' '}
                <span style={{ color: T.text }}>{email}</span>. Click it and you're in.
              </p>
              <div style={{
                padding: '14px 16px',
                background: T.accentGlow,
                borderLeft: `3px solid ${T.accent}`,
                color: T.textMuted,
                fontSize: 14,
                lineHeight: 1.55,
              }}>
                Didn't land? Check spam — sometimes new domains get filtered.
              </div>
              <button
                type="button"
                onClick={() => { setSent(false); setEmail(''); setError(null) }}
                style={{
                  marginTop: 18,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: T.accent,
                  fontSize: 14,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontFamily: T.sans,
                }}
              >
                Try a different email →
              </button>
            </>
          ) : (
            <>
              <AuthHeadline>Get started.</AuthHeadline>
              <p style={{
                fontSize: 14, lineHeight: 1.55,
                color: T.textFaint, margin: '0 0 6px',
              }}>
                We'll email you a sign-in link. Click it and you're in.
              </p>

              {linkErrorCopy && (
                <div style={{
                  marginTop: 14,
                  padding: '14px 16px',
                  background: 'rgba(240,153,123,0.08)',
                  borderLeft: `3px solid ${T.danger}`,
                  color: T.text,
                  fontSize: 14,
                  lineHeight: 1.55,
                }}>
                  {linkErrorCopy}
                </div>
              )}

              <form onSubmit={submit} style={{ display: 'grid', gap: 18, marginTop: 24 }}>
                <div>
                  <Eyebrow>Your email</Eyebrow>
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
                    {busy ? 'Sending…' : 'Get my sign-in link'}
                  </Button>
                </div>
              </form>

              <Divider />

              <a
                href={api.googleLoginUrl(next)}
                style={{
                  display: 'block',
                  background: 'transparent',
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
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
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .start-grid {
            grid-template-columns: 1fr !important;
            gap: 32px !important;
          }
        }
      `}</style>
    </div>
  )
}

function AuthHeadline({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily: T.heading, fontWeight: 600,
      fontSize: 'clamp(1.5rem, 2.5vw, 2rem)',
      letterSpacing: '-0.015em', lineHeight: 1.1,
      color: T.text, margin: '0 0 12px',
    }}>
      {children}
    </h2>
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
      margin: '24px 0 18px',
      color: T.textFaint, fontSize: 12,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
      or
      <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
    </div>
  )
}
