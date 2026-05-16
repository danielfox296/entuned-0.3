/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

// vite-plugin-pwa injects this manifest at build time. The reference type cast
// keeps TS happy under strict mode.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// New SW takes over open tabs ASAP so an updated player picks up bug fixes
// without requiring the operator to fully close and reopen the PWA.
self.addEventListener('install', () => { void self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

// ── Web Push: "music paused, tap to resume" nudges ────────────────────────
// Server fires these from the playback-heartbeat cron when an active session
// stops emitting song-progress events without an explicit operator pause.
// Payload shape (sent by apps/server/src/lib/push.ts):
//   { title: string, body: string, storeId?: string, url?: string }
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: { title?: string; body?: string; storeId?: string; url?: string } = {}
  try { payload = event.data.json() } catch { payload = { body: event.data.text() } }
  const title = payload.title ?? 'Entuned'
  const body = payload.body ?? 'Music paused — tap to resume.'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon-192x192.png',
      badge: '/favicon-192x192.png',
      tag: 'entuned-playback',
      // Replace any prior nudge for the same store rather than stacking.
      renotify: true,
      data: { url: payload.url ?? '/', storeId: payload.storeId ?? null },
    } as NotificationOptions),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Prefer focusing an existing tab over opening a new one. Operators in
    // standalone PWA mode usually have a single window already open.
    for (const c of all) {
      if ('focus' in c) {
        await c.focus()
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url)
  })())
})
