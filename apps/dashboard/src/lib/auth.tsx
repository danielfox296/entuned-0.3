import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, type MeResponse, type Role } from '../api.js'
import { TierProvider } from './tier.jsx'

export interface AuthState {
  user: MeResponse['user'] | null
  account: MeResponse['account'] | null
  role: Role | null
  loading: boolean
  refresh: () => void
}

// Hook: fetches /login/me on mount. Loading=true until the call settles.
// On 401 (or any error) user/account/role stay null and loading flips to false.
export function useAuth(): AuthState {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.me()
      .then((r) => { if (!cancelled) setMe(r) })
      .catch(() => { if (!cancelled) setMe(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tick])

  return {
    user: me?.user ?? null,
    account: me?.account ?? null,
    role: me?.role ?? null,
    loading,
    refresh: () => setTick((n) => n + 1),
  }
}

// Wrapper: redirects to /start if unauthenticated. While loading, renders
// nothing (a tiny flash) — for a customer dashboard this is acceptable;
// swap in a Spinner if it ever feels jarring.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) {
    return <Navigate to="/start" replace state={{ from: location.pathname }} />
  }
  return <TierProvider>{children}</TierProvider>
}
