import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { T } from '@entuned/tokens'
import { Button, CardChoice, Eyebrow, Input, Logo } from '../ui/index.js'
import type { ChoiceOption } from '../ui/index.js'
import { api } from '../api.js'
import type { StationRow } from '../api.js'
import { trackDashboardLanding, trackSignUp } from '../lib/ga4.js'
import { captureFirstTouch, readAttribution } from '../lib/attribution.js'
import { setPendingStation, readPendingStation } from '../lib/pendingStation.js'
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

/** Picker column count: 1 phone, 2 tablet, 3 desktop. */
function useStationColumns() {
  const read = () => {
    if (window.matchMedia('(max-width: 599px)').matches) return 1
    if (window.matchMedia('(max-width: 1023px)').matches) return 2
    return 3
  }
  const [columns, setColumns] = useState(read)
  useEffect(() => {
    const handler = () => setColumns(read())
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return columns
}

export function Start() {
  const mobile = useMobile()
  const stationColumns = useStationColumns()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next') ?? undefined
  const errorParam = searchParams.get('error')

  // GA4 — fire landing event once on mount. Also stamp the first-touch
  // attribution cookie if a visitor lands straight on /start (the marketing
  // site stamps it earlier for visitors who arrive via entuned.co).
  useEffect(() => {
    trackDashboardLanding()
    captureFirstTouch()
  }, [])

  const linkErrorCopy = (() => {
    if (!errorParam) return null
    const map = content.link_errors as Record<string, string>
    return map[errorParam] ?? map.default
  })()

  const returning = !!next

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Station picker. /start is pre-auth, so the pick is held client-side and
  // applied to the Store by the post-auth applier once the account exists.
  const [stations, setStations] = useState<Omit<StationRow, 'poolSize'>[]>([])
  const [station, setStation] = useState<string | null>(() => readPendingStation())
  useEffect(() => {
    // Catalogue is public and non-blocking: if it fails, signup still works —
    // the picker just doesn't render. Never gate the email form on it.
    api.stationCatalogue()
      .then((r) => setStations(r.stations))
      .catch(() => setStations([]))
  }, [])

  const chooseStation = (id: string) => {
    setStation(id)
    setPendingStation(id)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.requestMagicLink(email, next, readAttribution())
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
              <AuthHeadline>{returning ? content.auth.returning_headline : content.auth.headline}</AuthHeadline>
              <p style={{
                fontSize: 14, lineHeight: 1.55,
                color: T.textFaint, margin: '0 0 6px',
              }}>
                {returning ? content.auth.returning_sub : content.auth.sub}
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
                    {busy ? content.auth.submit_busy : returning ? content.auth.returning_submit : content.auth.submit}
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

      {/* STATION PICKER — pick your sound.
          Full-width below the fold-grid so six cards get room to breathe
          without squeezing the auth panel. Renders only once the public
          catalogue resolves; signup never waits on it. */}
      {stations.length > 0 && (
        <div style={{
          maxWidth: 1040,
          width: '100%',
          marginTop: mobile ? 40 : 64,
          paddingTop: mobile ? 32 : 44,
          borderTop: `1px solid ${T.borderSubtle}`,
          // The page shell is a centered flex column. Without this the grid
          // shrinks to fit the viewport instead of pushing the page taller,
          // and the lower station cards get clipped with nothing to scroll to.
          flexShrink: 0,
        }}>
          <Eyebrow>{content.stations.eyebrow}</Eyebrow>
          <h2 style={{
            fontFamily: T.heading,
            fontWeight: 600,
            fontSize: 'clamp(1.4rem, 2.4vw, 1.9rem)',
            letterSpacing: '-0.015em',
            lineHeight: 1.15,
            color: T.text,
            margin: '10px 0 8px',
          }}>
            {content.stations.headline}
          </h2>
          <p style={{
            fontSize: 15,
            lineHeight: 1.55,
            color: T.textDim,
            margin: '0 0 22px',
            maxWidth: '52ch',
          }}>
            {content.stations.sub}
          </p>

          <CardChoice
            columns={stationColumns}
            value={station}
            onChange={chooseStation}
            options={stations.map<ChoiceOption>((s) => ({
              id: s.id,
              label: s.displayName,
              hint: s.subtitle,
            }))}
          />

          {station && (
            <p style={{ fontSize: 14, color: T.textMuted, margin: '18px 0 0' }}>
              {content.stations.chosen_pre}
              <span style={{ color: T.accent }}>
                {stations.find((s) => s.id === station)?.displayName}
              </span>
              {content.stations.chosen_post}
            </p>
          )}
        </div>
      )}

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
