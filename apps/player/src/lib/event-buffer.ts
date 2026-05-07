import { api, type OutgoingEvent } from '../api.js'

const FLUSH_INTERVAL_MS = 30_000
const MAX_BUFFER_SIZE = 50

let buffer: OutgoingEvent[] = []
let flushTimer: number | null = null

function flush() {
  if (buffer.length === 0) return
  const batch = buffer
  buffer = []
  api.emit(batch).catch((e) => console.warn('[event-buffer] flush failed', e))
}

function ensureTimer() {
  if (flushTimer !== null) return
  flushTimer = window.setInterval(() => {
    flush()
    if (buffer.length === 0 && flushTimer !== null) {
      clearInterval(flushTimer)
      flushTimer = null
    }
  }, FLUSH_INTERVAL_MS)
}

export function bufferEvent(event: OutgoingEvent) {
  buffer.push(event)
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flush()
  } else {
    ensureTimer()
  }
}

export function flushNow() {
  flush()
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('beforeunload', () => flush())
}
