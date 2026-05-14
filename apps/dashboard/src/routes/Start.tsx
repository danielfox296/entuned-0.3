import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { T } from '../tokens.js'
import { Button, Eyebrow, Input, Logo } from '../ui/index.js'
import { api } from '../api.js'
import { trackDashboardLanding, trackSignUp } from '../lib/ga4.js'
import content from '../content/start.yaml'

function useMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return mobile
}

export function Start() {
  const mobile = useMobile()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next') ?? undefined
  const errorParam = searchParams.get('error')

  // GA4 — fire landing event once on mount.
  useEffect(() => { trackDashboardLanding() }, [])

  const linkErrorCopy = (() => {
    if (!errorParam) return null
    const map = content.link_errors as Record<string, string>
    return map[errorParam] ?? map.default
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
      trackSignUp('magic_link')
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : content.generic_error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(rgba(20,20,18,0.83), rgba(20,20,18,0.95)), url('/hero-start.jpg')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.sans,
      padding: mobile ? '24px 16px 40px' : '28px 64px 56px',
      color: T.text,
    }}>
      <div style={{ marginBottom: 48 }}>
        <Logo height={55} />
      </div>

      <div className="start-grid" style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 96,
        maxWidth: 1040,
        width: '100%',
        alignItems: 'center',
      }}>

        {/* LEFT — value prop */}
        <div>
          <h1 style={{
            fontFamily: T.heading,
            fontWeight: 700,
            fontSize: 'clamp(2.8rem, 4.5vw, 4rem)',
            letterSpacing: '-0.02em',
            lineHeight: 1.08,
            color: T.text,
            margin: '0 0 20px',
            maxWidth: '18ch',
          }}>
            {content.value.headline}
          </h1>
          <p style={{
            fontSize: 19,
            lineHeight: 1.6,
            color: T.textMuted,
            margin: '0 0 28px',
            maxWidth: '38ch',
          }}>
            {content.value.body}
          </p>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            fontSize: 15,
            color: T.text,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: T.accent, flexShrink: 0 }}>→</span>
              <span>{content.value.bullet_1}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: T.accent, flexShrink: 0 }}>→</span>
              <span>{content.value.bullet_2}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: T.accent, flexShrink: 0 }}>→</span>
              <span>{content.value.bullet_3}</span>
            </div>
          </div>
        </div>

        {/* RIGHT — auth */}
        <div style={{
          background: 'rgba(32,32,28,0.85)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: mobile ? '24px 20px' : '40px 36px',
        }}>
          {sent ? (
            <>
              <AuthHeadline>{content.auth.sent_headline}</AuthHeadline>
              <p style={{ fontSize: 15, lineHeight: 1.55, color: T.textDim, margin: '0 0 20px' }}>
                {content.auth.sent_pre_email}
                <span style={{ color: T.text }}>{email}</span>
                {content.auth.sent_post_email}
              </p>
              <div style={{
                padding: '14px 16px',
                background: T.accentGlow,
                borderLeft: `3px solid ${T.accent}`,
                color: T.textMuted,
                fontSize: 14,
                lineHeight: 1.55,
              }}>
                {content.auth.sent_spam_note}
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
                {content.auth.sent_try_different}
              </button>
            </>
          ) : (
            <>
              <AuthHeadline>{content.auth.headline}</AuthHeadline>
              <p style={{
                fontSize: 14, lineHeight: 1.55,
                color: T.textFaint, margin: '0 0 6px',
              }}>
                {content.auth.sub}
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
                  <Eyebrow>{content.auth.email_label}</Eyebrow>
                  <BigInput
                    type="email"
                    name="email"
                    autoComplete="email"
                    value={email}
                    required
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={content.auth.email_placeholder}
                    autoFocus
                  />
                </div>

                {error && (
                  <div style={{ fontSize: 13, color: T.danger }}>{error}</div>
                )}

                <div style={{ marginTop: 4 }}>
                  <Button type="submit" busy={busy}>
                    {busy ? content.auth.submit_busy : content.auth.submit}
                  </Button>
                </div>
              </form>

              <Divider label={content.auth.divider} />

              <a
                href={api.googleLoginUrl(next)}
                onClick={() => trackSignUp('google')}
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
                {content.auth.google}
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
        // clamp keeps "you@yourstore.com" from clipping inside the narrow auth panel on mobile
        fontSize: 'clamp(18px, 4.8vw, 24px)',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        padding: '8px 0',
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
      }}
    />
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '24px 0 18px',
      color: T.textFaint, fontSize: 12,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
      {label}
      <div style={{ flex: 1, height: 1, background: T.borderSubtle }} />
    </div>
  )
}
