import { prisma } from '../db.js'
import { sendPush, isPushConfigured, type StoredSubscription } from './push.js'

// Heartbeat detection: stores that were playing recently but have gone silent
// without explicit operator pause are candidates for a "music paused — tap to
// resume" push nudge. This catches OS-driven kills (iOS Safari memory pressure,
// alarms, lock-screen suspends) that don't surface to the player.

const ACTIVE_WINDOW_MS = 30 * 60 * 1000 // Was playing within 30 min → still considered active session
const SILENCE_WINDOW_MS = 10 * 60 * 1000 // No progress event in 10 min → suspect
const NUDGE_COOLDOWN_MS = 30 * 60 * 1000 // Don't re-nudge within 30 min of the last attempt

const STREAM_PROGRESS_EVENTS = ['song_start', 'song_complete', 'song_skip', 'ad_play'] as const

export type HeartbeatStats = {
  scanned: number
  nudged: number
  expired: number
  failed: number
}

export async function runPlaybackHeartbeat(now: Date = new Date()): Promise<HeartbeatStats> {
  const stats: HeartbeatStats = { scanned: 0, nudged: 0, expired: 0, failed: 0 }
  if (!isPushConfigured()) return stats

  const activeCutoff = new Date(now.getTime() - ACTIVE_WINDOW_MS)
  const silenceCutoff = new Date(now.getTime() - SILENCE_WINDOW_MS)
  const nudgeCutoff = new Date(now.getTime() - NUDGE_COOLDOWN_MS)

  // Recently active stores — those with a streaming-progress event in the last 30min.
  const recentEvents = await prisma.playbackEvent.findMany({
    where: {
      eventType: { in: [...STREAM_PROGRESS_EVENTS] },
      occurredAt: { gte: activeCutoff },
    },
    select: { storeId: true, occurredAt: true, eventType: true },
    orderBy: { occurredAt: 'desc' },
  })

  // Group by store, take most-recent event per store.
  const lastByStore = new Map<string, Date>()
  for (const e of recentEvents) {
    if (!lastByStore.has(e.storeId)) lastByStore.set(e.storeId, e.occurredAt)
  }

  for (const [storeId, lastAt] of lastByStore) {
    stats.scanned += 1
    if (lastAt > silenceCutoff) continue // Still actively emitting progress events — healthy.

    // Did the operator explicitly pause? Check the most-recent event of any
    // type — if it's operator_pause without a subsequent resume/start, skip.
    const mostRecent = await prisma.playbackEvent.findFirst({
      where: { storeId, occurredAt: { gte: activeCutoff } },
      orderBy: { occurredAt: 'desc' },
      select: { eventType: true },
    })
    if (mostRecent?.eventType === 'operator_pause' || mostRecent?.eventType === 'operator_logout') continue

    // Cooldown: don't re-nudge if any subscription for this store was nudged recently.
    const cooled = await prisma.pushSubscription.findFirst({
      where: { storeId, lastNudgedAt: { gte: nudgeCutoff } },
      select: { id: true },
    })
    if (cooled) continue

    const subs = await prisma.pushSubscription.findMany({
      where: { storeId },
      select: { id: true, endpoint: true, p256dhKey: true, authKey: true, store: { select: { name: true } } },
    })
    if (subs.length === 0) continue

    const storeName = subs[0]?.store.name ?? 'Entuned'

    for (const s of subs) {
      const subInput: StoredSubscription = {
        id: s.id,
        endpoint: s.endpoint,
        p256dhKey: s.p256dhKey,
        authKey: s.authKey,
      }
      const result = await sendPush(subInput, {
        title: storeName,
        body: 'Music paused — tap to resume.',
        storeId,
        url: '/',
      })
      if (result === 'sent') stats.nudged += 1
      else if (result === 'expired') stats.expired += 1
      else stats.failed += 1
    }

    // Mark all subs for this store as nudged so the cooldown applies.
    await prisma.pushSubscription.updateMany({
      where: { storeId },
      data: { lastNudgedAt: now },
    })
  }

  return stats
}
