import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

// /r/:code — referral landing. Stores the referral code in sessionStorage
// so the sign-up flow can attribute the new signup, then redirects to /start.
// No content to render — redirect is instant.

export function ReferralLanding() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (code) {
      sessionStorage.setItem('entuned_referral_code', code)
    }
    navigate('/start', { replace: true })
  }, [code, navigate])

  return null
}
