import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { T } from '@entuned/tokens'
import { Eyebrow, Logo } from '../ui/index.js'
import { api } from '../api.js'
import { trackOnboardingComplete } from '../lib/ga4.js'
import content from '../content/welcome.yaml'

// /welcome?session=cs_... — landing page after Stripe Checkout returns.
// Confirms the account is provisioned, then routes to the ICP intake wizard.
//
// Copy is concrete on the pending state ("Finishing payment...") so a
// just-paid customer doesn't sit there wondering whether the charge worked.
export function Welcome() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)

  const sessionId = params.get('session')

  useEffect(() => {
    if (!sessionId) {
      setStatus('error')
      setError(content.error.missing_session)
      return
    }
    let cancelled = false
    api.confirmCheckoutSession(sessionId)
      .then((r) => {
        if (cancelled) return
        if (r.status === 'provisioned') {
          setStatus('ready')
          trackOnboardingComplete()
          // Brief pause for the confirmation, then straight to the brand
          // intake. /welcome is only reached after Stripe checkout returns,
          // so the user is paid (Core+) and unlocked for /intake. This is
          // where they get value first — landing them on Home would skip
          // the highest-leverage activation step.
          setTimeout(() => navigate('/intake', { replace: true }), 1200)
        } else {
          setStatus('pending')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : content.error.generic)
      })
    return () => { cancelled = true }
  }, [sessionId, navigate])

  return (
    <div style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.sans, padding: 24, color: T.text,
    }}>
      <div style={{ width: 520, maxWidth: '100%' }}>
        <div style={{ marginBottom: 40 }}>
          <Logo />
        </div>

        {status === 'pending' && (
          <>
            <Eyebrow>{content.pending.eyebrow}</Eyebrow>
            <Headline>{content.pending.headline}</Headline>
            <Sub>{content.pending.sub}</Sub>
            <ol style={{
              margin: '20px 0 0', padding: 0, listStyle: 'none',
              display: 'grid', gap: 10, color: T.textMuted,
              fontSize: 14, lineHeight: 1.5,
            }}>
              <li style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span style={{
                  fontFamily: T.heading, color: T.accent,
                  fontWeight: 600, minWidth: 20,
                }}>01</span>
                {content.pending.step_1}
              </li>
              <li style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span style={{
                  fontFamily: T.heading, color: T.accent,
                  fontWeight: 600, minWidth: 20,
                }}>02</span>
                {content.pending.step_2}
              </li>
              <li style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span style={{
                  fontFamily: T.heading, color: T.accent,
                  fontWeight: 600, minWidth: 20,
                }}>03</span>
                {content.pending.step_3}
              </li>
            </ol>
            <Pulse />
          </>
        )}
        {status === 'ready' && (
          <>
            <Eyebrow>{content.ready.eyebrow}</Eyebrow>
            <Headline>{content.ready.headline}</Headline>
            <Sub>{content.ready.sub}</Sub>
          </>
        )}
        {status === 'error' && (
          <>
            <Eyebrow>{content.error.eyebrow}</Eyebrow>
            <Headline>{content.error.headline}</Headline>
            <Sub style={{ color: T.danger }}>
              {error ?? content.error.sub_fallback}
            </Sub>
          </>
        )}
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

function Sub({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontSize: 15, lineHeight: 1.55,
      color: T.textDim, margin: 0, maxWidth: '52ch',
      ...style,
    }}>
      {children}
    </p>
  )
}

function Pulse() {
  return (
    <div style={{
      marginTop: 28,
      height: 2,
      background: T.borderSubtle,
      position: 'relative',
      overflow: 'hidden',
      width: 200,
    }}>
      <div style={{
        position: 'absolute',
        top: 0, left: 0, height: '100%', width: '40%',
        background: T.accent,
        animation: 'entuned-pulse 1.4s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes entuned-pulse {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  )
}
