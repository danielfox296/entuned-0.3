import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, primaryStore, type MeResponse, type Role } from '../api.js'
import { TierProvider } from './tier.jsx'
import { readPendingStation, clearPendingStation } from './pendingStation.js'

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

// Applies the station picked at signup, once.
//
// The picker runs on /start, which is pre-auth — no Store exists yet to write
// the choice to. This is the first authenticated moment, so it's where the pick
// lands. Fire-and-forget: any failure clears the pending key rather than
// retrying forever, because the customer can always re-pick in the player and
// no dashboard flow should block on a preference.
function useApplyPendingStation(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const pending = readPendingStation()
    if (!pending) return
    let cancelled = false
    ;(async () => {
      try {
        // The station write is store-scoped, so resolve the store first. A
        // brand-new signup is provisioned with one by GET /me/stores.
        const { stores } = await api.meStores()
        const store = primaryStore(stores)
        if (store) await api.setStoreStation(store.id, pending)
      } catch {
        // Store not provisioned yet, or the station was retired between the
        // pick and the sign-in. Either way, drop it.
      } finally {
        if (!cancelled) clearPendingStation()
      }
    })()
    return () => { cancelled = true }
  }, [ready])
}

// Wrapper: redirects to /start if unauthenticated. While loading, renders
// nothing (a tiny flash) — for a customer dashboard this is acceptable;
// swap in a Spinner if it ever feels jarring.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  useApplyPendingStation(!loading && !!user)
  if (loading) return null
  if (!user) {
    const next = location.pathname + location.search
    return <Navigate to={`/start?next=${encodeURIComponent(next)}`} replace />
  }
  return <TierProvider>{children}</TierProvider>
}
