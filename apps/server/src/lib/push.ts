import webpush from 'web-push'
import { prisma } from '../db.js'

// VAPID identity. PUSH_VAPID_SUBJECT is the contact URL/mailto pushed to the
// browser vendor; the two keys are the keypair generated via:
//   pnpm exec web-push generate-vapid-keys
// PUSH_VAPID_PUBLIC_KEY is also exposed to the player at /push/vapid-public-key.
const PUBLIC_KEY = process.env.PUSH_VAPID_PUBLIC_KEY ?? ''
const PRIVATE_KEY = process.env.PUSH_VAPID_PRIVATE_KEY ?? ''
const SUBJECT = process.env.PUSH_VAPID_SUBJECT ?? 'mailto:hi@entuned.co'

let configured = false
function ensureConfigured(): boolean {
  if (configured) return true
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)
  configured = true
  return true
}

export function getPublicKey(): string | null {
  return PUBLIC_KEY || null
}

export function isPushConfigured(): boolean {
  return ensureConfigured()
}

export type PushPayload = {
  title: string
  body: string
  storeId?: string
  url?: string
}

export type StoredSubscription = {
  id: string
  endpoint: string
  p256dhKey: string
  authKey: string
}

// Send a push notification to a single subscription. On 404/410 (subscription
// expired), the row is deleted so it stops getting hit. Other errors are
// logged but don't throw — callers send to many subs in parallel and want
// best-effort fan-out.
export async function sendPush(sub: StoredSubscription, payload: PushPayload): Promise<'sent' | 'expired' | 'failed'> {
  if (!ensureConfigured()) return 'failed'
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
      },
      JSON.stringify(payload),
      { TTL: 300 }, // 5min — stale resume nudges are noise; let them expire.
    )
    return 'sent'
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      // Subscription is gone — drop it.
      try {
        await prisma.pushSubscription.delete({ where: { id: sub.id } })
      } catch {}
      return 'expired'
    }
    console.warn('[push] send failed', { statusCode, endpoint: sub.endpoint.slice(0, 64) })
    return 'failed'
  }
}
