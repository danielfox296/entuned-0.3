import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { T } from '../tokens.js'
import { Button, Eyebrow, Input, Logo } from '../ui/index.js'
import { api } from '../api.js'

// /start — magic-link request + Google OAuth entry. Customer-facing login.
// No password field by design: passwordless via magic link.
//
// Friendly first-touch copy: no step counter (visitor doesn't know there's
// a flow yet), outcome-promising CTA, no "no password" objection-flip.
export function Start() {
  const [searchParams] = useSearchParams()
  // ?next=<url> rides through both the magic-link email and the Google OAuth
  // handshake so logged-out clicks on links like /billing/upgrade-from-comp
  // route the user back to where they were trying to go after auth.
  const next = searchParams.get('next') ?? undefined
  const errorParam = searchParams.get('error')

  // Map redirect-error codes from /login/verify into friendly copy.
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
    <Shell>
      {sent ? (
        <>
          <Headline>Check your inbox.</Headline>
          <Sub>
            We sent a sign-in link to{' '}
            <span style={{ color: T.text }}>{email}</span>. Click it and you're in.
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
            Didn't land? It's worth a peek in spam — sometimes new domains get
            filtered.
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
          <Headline>Start your store's soundtrack.</Headline>
          <Sub>
            Pick a vibe — slow the room down (Increase Dwell) or lift
            the energy — and Entuned plays original, retail-licensed
            music through your existing speakers. Free forever, no
            card.
          </Sub>
          <details style={{
            marginTop: 14, fontSize: 13, color: T.textFaint,
            lineHeight: 1.55,
          }}>
            <summary style={{
              cursor: 'pointer', color: T.textMuted, fontSize: 13,
              padding: '4px 0',
            }}>
              How does it actually play through my speakers?
            </summary>
            <div style={{ marginTop: 8, paddingLeft: 4 }}>
              Entuned is a web player. After you sign in, you get a URL
              like <code style={{ fontSize: 12, color: T.text }}>music.entuned.co/your-shop</code>.
              Open that on whatever device feeds your shop's speakers
              — the laptop behind the counter, an iPad, a phone paired
              over Bluetooth, a Sonos via AirPlay. Press play. Music
              starts. No app to install, no hardware to buy.
            </div>
          </details>
          <div style={{
            marginTop: 14, fontSize: 13, color: T.textFaint,
          }}>
            We'll email you a sign-in link. Click it and you're in.
          </div>

          {linkErrorCopy && (
            <div style={{
              marginTop: 18,
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

          <form onSubmit={submit} style={{ display: 'grid', gap: 18, marginTop: 32 }}>
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
        <div style={{ marginBottom: 40 }}>
          <Logo />
        </div>
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
