import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, highestTier, type StoreRow, type Tier } from '../api.js'
import { T } from '../tokens.js'

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
//
// Children render only after the first /me/stores resolves. Otherwise sidebar
// + tier-gated routes flash a Free-tier UI to paid customers (telling them to
// upgrade to a tier they already pay for) before /me/stores arrives.
// Subsequent refreshes do NOT re-block — `loading` is exposed for inline spinners.
export function TierProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.meStores()
      .then((r) => { if (!cancelled) setStores(r.stores) })
      .catch(() => { if (!cancelled) setStores([]) })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setHydrated(true)
      })
    return () => { cancelled = true }
  }, [tick])

  const value = useMemo<TierContextValue>(() => ({
    stores,
    tier: highestTier(stores),
    loading,
    refresh: () => setTick((n) => n + 1),
  }), [stores, loading])

  if (!hydrated) {
    return (
      <div style={{
        width: '100%', height: '100vh',
        background: T.bg, color: T.textDim,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: T.sans, fontSize: 13,
      }}>
        Loading…
      </div>
    )
  }

  return <TierContext.Provider value={value}>{children}</TierContext.Provider>
}

export function useTier(): TierContextValue {
  const ctx = useContext(TierContext)
  if (!ctx) throw new Error('useTier must be used inside <TierProvider>')
  return ctx
}
