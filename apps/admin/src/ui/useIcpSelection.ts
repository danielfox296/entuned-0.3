import { useEffect, useState } from 'react'

const KEY = 'entuned:admin:selected_icp_v1'
const EVENT = 'entuned-icp-changed'

function read(): string | null {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

/**
 * Shared ICP selection across workflow panels. Mirrors useStoreSelection.
 * Callers are responsible for clearing this when the active store changes
 * if the persisted ICP no longer belongs to the new store.
 */
export function useIcpSelection(): [string | null, (id: string | null) => void] {
  const [icpId, setIcpId] = useState<string | null>(read)

  useEffect(() => {
    const sync = () => setIcpId(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = (id: string | null) => {
    setIcpId(id)
    try {
      if (id) localStorage.setItem(KEY, id)
      else localStorage.removeItem(KEY)
    } catch {}
    window.dispatchEvent(new Event(EVENT))
  }

  return [icpId, update]
}
