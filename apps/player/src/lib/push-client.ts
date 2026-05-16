import { api } from '../api.js'
import { getServiceWorkerRegistration } from './sw-register.js'

// Player-side Web Push lifecycle. Used by PlayerScreen to subscribe the device
// once Notification permission is granted, and to unsubscribe on operator
// logout. Idempotent — repeated subscribe calls reuse the same browser-level
// PushSubscription and re-upsert on the server.
//
// Returns the endpoint URL on success so callers can persist it for
// pushUnsubscribe later. Returns null when push isn't available (no SW, no
// permission, no VAPID key, or browser doesn't support push).

const STORAGE_KEY = 'entuned.push_endpoint_v1'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function arrayBufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export type SubscribeArgs = {
  storeId: string
  token?: string
  slug?: string
}

export async function subscribePush(args: SubscribeArgs): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null

  // Don't prompt — only proceed if the user already granted permission.
  // The caller (PlayerScreen) is responsible for the prompt UX timing.
  if (Notification.permission !== 'granted') return null

  const reg = await getServiceWorkerRegistration()
  if (!reg) return null

  let vapid: { publicKey: string; configured: boolean }
  try { vapid = await api.vapidPublicKey() } catch { return null }
  if (!vapid?.configured || !vapid.publicKey) return null

  let sub: PushSubscription | null
  try {
    sub = await reg.pushManager.getSubscription()
    if (!sub) {
      // Re-allocate into a fresh ArrayBuffer so the TS view type is
      // BufferSource-compatible (strict mode rejects the ArrayBufferLike default).
      const keyBytes = urlBase64ToUint8Array(vapid.publicKey)
      const buf = new ArrayBuffer(keyBytes.byteLength)
      new Uint8Array(buf).set(keyBytes)
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: buf,
      })
    }
  } catch {
    return null
  }

  const p256dh = sub.getKey('p256dh')
  const auth = sub.getKey('auth')
  if (!p256dh || !auth) return null

  try {
    await api.pushSubscribe({
      store_id: args.storeId,
      endpoint: sub.endpoint,
      p256dh_key: arrayBufferToBase64(p256dh),
      auth_key: arrayBufferToBase64(auth),
      user_agent: navigator.userAgent.slice(0, 200),
      slug: args.slug,
    }, args.token)
  } catch {
    return null
  }

  try { localStorage.setItem(STORAGE_KEY, sub.endpoint) } catch {}
  return sub.endpoint
}

export async function unsubscribePush(): Promise<void> {
  if (typeof window === 'undefined') return
  let endpoint: string | null = null
  try { endpoint = localStorage.getItem(STORAGE_KEY) } catch {}
  // Unregister at the browser level too — otherwise the device keeps a stale
  // subscription that can't be reached.
  if ('serviceWorker' in navigator) {
    try {
      const reg = await getServiceWorkerRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        endpoint = endpoint ?? sub.endpoint
        await sub.unsubscribe().catch(() => {})
      }
    } catch {}
  }
  if (endpoint) {
    try { await api.pushUnsubscribe(endpoint) } catch {}
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }
}
