import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { T } from '../tokens.js'
import { api } from '../api.js'

// /welcome?session=cs_... — landing page after Stripe Checkout returns.
// Confirms the account is provisioned, then routes to the ICP intake wizard.
export function Welcome() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)

  const sessionId = params.get('session')

  useEffect(() => {
    if (!sessionId) {
      setStatus('error')
      setError('Missing checkout session id.')
      return
    }
    let cancelled = false
    api.confirmCheckoutSession(sessionId)
      .then((r) => {
        if (cancelled) return
        if (r.status === 'provisioned') {
          setStatus('ready')
          // Brief pause so the user sees the confirmation, then on to intake.
          setTimeout(() => navigate('/intake', { replace: true }), 1200)
        } else {
          setStatus('pending')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to confirm checkout.')
      })
    return () => { cancelled = true }
  }, [sessionId, navigate])

  return (
    <div style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.sans, padding: 24,
    }}>
      <div style={{ width: 420, textAlign: 'center' }}>
        <div style={{
          fontFamily: T.heading, fontSize: 22, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em', marginBottom: 28,
        }}>entuned</div>

        {status === 'pending' && (
          <div style={{ color: T.textMuted, fontSize: 15, lineHeight: 1.6 }}>
            Setting up your account…
          </div>
        )}
        {status === 'ready' && (
          <div style={{ color: T.text, fontSize: 16, lineHeight: 1.6 }}>
            Account ready. Taking you to the brand intake.
          </div>
        )}
        {status === 'error' && (
          <div style={{ color: T.danger, fontSize: 14, lineHeight: 1.6 }}>
            {error ?? 'Something went wrong. Reach out at hello@entuned.co.'}
          </div>
        )}
      </div>
    </div>
  )
}
