import { useState } from 'react'
import { T } from '../tokens.js'
import { Button, Input } from '../ui/index.js'
import { api } from '../api.js'

// /start — magic-link request + Google OAuth entry. Customer-facing login.
// No password field by design: passwordless via magic link.
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
    <div style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.sans, padding: 24,
    }}>
      <div style={{ width: 360 }}>
        <div style={{
          fontFamily: T.heading, fontSize: 22, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', marginBottom: 28,
        }}>entuned</div>

        {sent ? (
          <div style={{
            background: T.accentGlow,
            border: `1px solid ${T.accentMuted}`,
            borderRadius: 6,
            padding: 20,
            color: T.text,
            fontSize: 14,
            lineHeight: 1.6,
          }}>
            Check your email. We sent a sign-in link to <strong>{email}</strong>.
          </div>
        ) : (
          <>
            <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
              <Input
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
              />
              <Button type="submit" busy={busy}>
                {busy ? 'sending…' : 'Email me a sign-in link'}
              </Button>
              {error && (
                <div style={{ fontSize: 13, color: T.danger }}>{error}</div>
              )}
            </form>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              margin: '20px 0', color: T.textFaint, fontSize: 12,
            }}>
              <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
              or
              <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
            </div>

            <a
              href={api.googleLoginUrl()}
              style={{
                display: 'block',
                background: T.surfaceRaised,
                border: `1px solid ${T.border}`,
                borderRadius: 4,
                padding: '10px 14px',
                fontSize: 14,
                color: T.text,
                textAlign: 'center',
              }}
            >
              Continue with Google
            </a>
          </>
        )}
      </div>
    </div>
  )
}
