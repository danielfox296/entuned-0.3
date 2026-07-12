// Persistent IndexedDB event buffer.
//
// Why IDB instead of an in-memory array: an iPad that goes to sleep mid-flush
// (or whose tab is killed by iOS memory pressure) loses everything sitting in
// memory. For POS×audio correlation a 15-minute hole at 7pm Friday is a
// catastrophic gap; events must survive a tab restart, a forced sleep, or a
// long network outage.
//
// Contract:
// - bufferEvent() append is fire-and-forget; it never blocks the caller.
// - Every event is stamped with idempotency_key + client_sent_at on insert.
//   The server's UNIQUE index on idempotency_key dedupes flush retries, so
//   we can retry aggressively without creating duplicate rows.
// - Failed flushes back off exponentially (1s → 60s cap) and resume.
// - On page load we drain anything left from the prior session.

import { api, type OutgoingEvent } from '../api.js'

const DB_NAME = 'entuned-player'
const DB_VERSION = 1
const STORE = 'event_queue'
const FLUSH_INTERVAL_MS = 30_000
const MAX_BATCH = 50

type StoredEvent = OutgoingEvent & { _id?: number }

let dbPromise: Promise<IDBDatabase> | null = null
let flushTimer: number | null = null
let flushing = false
let backoffMs = 1000

// Auth credential for `/events` (SEC-3). Set once when the PlayerScreen mounts
// with the resolved session: operator sessions carry a Bearer token, slug
// sessions carry the slug. The buffer is a module singleton with no session
// context of its own, so the screen pushes the credential in here.
let eventAuth: { slug?: string; token?: string } = {}
export function setEventAuth(auth: { slug?: string; token?: string }): void {
  eventAuth = auth
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: '_id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function append(ev: OutgoingEvent): Promise<void> {
  const d = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add(ev)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function readBatch(): Promise<StoredEvent[]> {
  const d = await openDb()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll(undefined, MAX_BATCH)
    req.onsuccess = () => resolve(req.result as StoredEvent[])
    req.onerror = () => reject(req.error)
  })
}

async function deleteIds(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  const d = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const id of ids) store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function scheduleFlush(): void {
  if (flushTimer !== null) return
  flushTimer = window.setInterval(() => { void flush() }, FLUSH_INTERVAL_MS)
}

async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    while (true) {
      const batch = await readBatch()
      if (batch.length === 0) break
      const payload = batch.map(({ _id: _, ...e }) => e)
      try {
        await api.emit(payload, eventAuth)
        await deleteIds(batch.map((b) => b._id!).filter((id): id is number => typeof id === 'number'))
        backoffMs = 1000
      } catch (e) {
        console.warn('[event-buffer] flush failed, will retry', e)
        backoffMs = Math.min(backoffMs * 2, 60_000)
        window.setTimeout(() => { void flush() }, backoffMs)
        return
      }
    }
  } finally {
    flushing = false
  }
}

export function bufferEvent(event: OutgoingEvent): void {
  // Stamp idempotency + client clock at append time, not at flush time. If a
  // batch sits offline for 20 minutes the timestamp still reflects when it
  // happened, and the idempotency key survives retries cleanly.
  const enriched: OutgoingEvent = {
    ...event,
    client_sent_at: event.client_sent_at ?? new Date().toISOString(),
    idempotency_key: event.idempotency_key ?? crypto.randomUUID(),
  }
  void append(enriched).then(scheduleFlush).catch((e) => {
    console.warn('[event-buffer] append failed', e)
  })
}

export function flushNow(): void { void flush() }

if (typeof window !== 'undefined' && 'indexedDB' in window) {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
  window.addEventListener('beforeunload', () => { void flush() })
  // Drain anything left from a prior tab/session on mount.
  void flush()
  scheduleFlush()
}
