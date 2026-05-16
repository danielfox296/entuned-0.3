// IndexedDB-backed audio cache.
//
// Pre-fetches the next 2-3 tracks as Blobs so playback survives 60+ second
// network blips and OS-driven cache evictions. Storage is keyed by song_id
// (R2 URLs are unsigned and stable, so song_id is the canonical identity).
//
// Eviction: LRU once total bytes exceed MAX_BYTES. Stored row metadata tracks
// size + last-accessed time. Cache is best-effort — every entry point gracefully
// falls back to the network URL.

const DB_NAME = 'entuned-audio-cache'
const DB_VERSION = 1
const STORE = 'tracks'
const MAX_BYTES = 100 * 1024 * 1024 // ~100MB; ~25 typical 3-min tracks at 192kbps.

type TrackRow = {
  songId: string
  blob: Blob
  bytes: number
  lastAccessedAt: number
  cachedAt: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'songId' })
        store.createIndex('lastAccessedAt', 'lastAccessedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      console.warn('[audio-cache] open failed', req.error)
      resolve(null)
    }
  })
  return dbPromise
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE)
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getRow(songId: string): Promise<TrackRow | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const row = (await promisify(tx(db, 'readonly').get(songId))) as TrackRow | undefined
    return row ?? null
  } catch {
    return null
  }
}

async function putRow(row: TrackRow): Promise<void> {
  const db = await openDb()
  if (!db) return
  try { await promisify(tx(db, 'readwrite').put(row)) } catch {}
}

async function totalBytes(): Promise<number> {
  const db = await openDb()
  if (!db) return 0
  try {
    const cursor = tx(db, 'readonly').openCursor()
    return await new Promise<number>((resolve) => {
      let sum = 0
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) { resolve(sum); return }
        sum += (c.value as TrackRow).bytes ?? 0
        c.continue()
      }
      cursor.onerror = () => resolve(sum)
    })
  } catch { return 0 }
}

async function evictUntilUnderQuota(targetBytes: number): Promise<void> {
  const db = await openDb()
  if (!db) return
  let current = await totalBytes()
  if (current <= targetBytes) return
  try {
    const store = tx(db, 'readwrite')
    const idx = store.index('lastAccessedAt')
    const cursor = idx.openCursor()
    await new Promise<void>((resolve) => {
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c || current <= targetBytes) { resolve(); return }
        const row = c.value as TrackRow
        current -= row.bytes ?? 0
        c.delete()
        c.continue()
      }
      cursor.onerror = () => resolve()
    })
  } catch {}
}

// In-flight prefetch dedupe: avoids double-fetching the same song when the
// queue refill races with the active prefetch.
const inflight = new Map<string, Promise<void>>()

export async function prefetch(songId: string, url: string): Promise<void> {
  if (!songId || !url) return
  const existing = await getRow(songId)
  if (existing) return
  const pending = inflight.get(songId)
  if (pending) return pending
  const job = (async () => {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
      if (!res.ok) return
      const blob = await res.blob()
      const bytes = blob.size
      if (bytes > MAX_BYTES / 2) return // Single file too large to be worth caching.
      await evictUntilUnderQuota(MAX_BYTES - bytes)
      await putRow({ songId, blob, bytes, lastAccessedAt: Date.now(), cachedAt: Date.now() })
    } catch {
      // Network failure / CORS / quota — silently fall back to streaming.
    } finally {
      inflight.delete(songId)
    }
  })()
  inflight.set(songId, job)
  return job
}

// Returns a same-origin blob URL when cached, else null. Caller should fall
// back to the original network URL. Bumps last-accessed for LRU.
export async function getCachedUrl(songId: string): Promise<string | null> {
  if (!songId) return null
  const row = await getRow(songId)
  if (!row) return null
  // Update last-accessed; ignore failures.
  void putRow({ ...row, lastAccessedAt: Date.now() })
  try {
    return URL.createObjectURL(row.blob)
  } catch { return null }
}

// Caller-managed lifetime — revoke the blob URL once Howler has finished with
// it. Forgetting to revoke leaks memory until the tab closes.
export function revokeCachedUrl(blobUrl: string): void {
  if (blobUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(blobUrl) } catch {}
  }
}

export async function getCacheStats(): Promise<{ count: number; bytes: number }> {
  const db = await openDb()
  if (!db) return { count: 0, bytes: 0 }
  try {
    const cursor = tx(db, 'readonly').openCursor()
    return await new Promise((resolve) => {
      let count = 0
      let bytes = 0
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) { resolve({ count, bytes }); return }
        count += 1
        bytes += (c.value as TrackRow).bytes ?? 0
        c.continue()
      }
      cursor.onerror = () => resolve({ count, bytes })
    })
  } catch { return { count: 0, bytes: 0 } }
}

// Test-only helper.
export async function clearCache(): Promise<void> {
  const db = await openDb()
  if (!db) return
  try { await promisify(tx(db, 'readwrite').clear()) } catch {}
}
