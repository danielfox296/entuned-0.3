import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, highestTier, type StoreRow, type Tier } from '../api.js'

interface TierContextValue {
  stores: StoreRow[]
  tier: Tier
  loading: boolean
  refresh: () => void
}

const TierContext = createContext<TierContextValue | null>(null)

// Fetches /me/stores once and exposes the result + the derived "highest tier"
// across the Client's stores. Any descendant component reads it via useTier().
// Refresh is exposed so post-action surfaces (pause/resume) can re-pull.
export function TierProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.meStores()
      .then((r) => { if (!cancelled) setStores(r.stores) })
      .catch(() => { if (!cancelled) setStores([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tick])

  const value = useMemo<TierContextValue>(() => ({
    stores,
    tier: highestTier(stores),
    loading,
    refresh: () => setTick((n) => n + 1),
  }), [stores, loading])

  return <TierContext.Provider value={value}>{children}</TierContext.Provider>
}

export function useTier(): TierContextValue {
  const ctx = useContext(TierContext)
  if (!ctx) throw new Error('useTier must be used inside <TierProvider>')
  return ctx
}
