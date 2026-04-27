import { useEffect, useState } from 'react'

const KEY = 'entuned:admin:selected_store_v1'
const EVENT = 'entuned-store-changed'

function read(): string | null {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

/**
 * Shared store selection across all admin panels. Persists to localStorage
 * and syncs intra-window via a custom event so picking in one panel updates
 * every other panel without a reload.
 */
export function useStoreSelection(): [string | null, (id: string | null) => void] {
  const [storeId, setStoreId] = useState<string | null>(read)

  useEffect(() => {
    const sync = () => setStoreId(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = (id: string | null) => {
    setStoreId(id)
    try {
      if (id) localStorage.setItem(KEY, id)
      else localStorage.removeItem(KEY)
    } catch {}
    window.dispatchEvent(new Event(EVENT))
  }

  return [storeId, update]
}
