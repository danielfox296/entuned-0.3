import { useEffect, useState } from 'react'

const KEY = 'entuned:admin:selected_client_v1'
const EVENT = 'entuned-client-changed'

function read(): string | null {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

/**
 * Shared client selection across all admin panels. Mirrors useStoreSelection.
 */
export function useClientSelection(): [string | null, (id: string | null) => void] {
  const [clientId, setClientId] = useState<string | null>(read)

  useEffect(() => {
    const sync = () => setClientId(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = (id: string | null) => {
    setClientId(id)
    try {
      if (id) localStorage.setItem(KEY, id)
      else localStorage.removeItem(KEY)
    } catch {}
    window.dispatchEvent(new Event(EVENT))
  }

  return [clientId, update]
}
