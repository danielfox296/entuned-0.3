// GET /admin/retention — read-only aggregation over PlaybackEvent + Store data.
// No new tables, no schema changes, compute on request.
//
// Honest-data rule: every number returned here is derived from real logged
// events. No estimates, no fallback heuristics. If we don't have the event,
// we don't fabricate the number — we just don't show it.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../db.js'
import { verify } from '../lib/auth.js'
import { effectiveTier } from '../lib/tier.js'

interface AuthedOp { accountId: string; email: string; isAdmin: boolean }

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthedOp | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { reply.code(401).send({ error: 'unauthorized' }); return null }
  const payload = verify(auth.slice(7))
  if (!payload) { reply.code(401).send({ error: 'invalid_token' }); return null }
  if (!payload.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
  const op = await prisma.account.findUnique({ where: { id: payload.accountId } })
  if (!op || op.disabledAt || !op.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
  if (op.tokenVersion !== payload.tv) { reply.code(401).send({ error: 'token_revoked' }); return null }
  return { accountId: op.id, email: op.email, isAdmin: op.isAdmin }
}

// ISO 8601 week string, e.g. "2026-W20"
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// Count sessions: gap-based grouping of song_start events. Gap > 60 min = new session.
function countSessions(starts: { occurredAt: Date }[]): number {
  if (starts.length === 0) return 0
  let sessions = 1
  for (let i = 1; i < starts.length; i++) {
    if (starts[i]!.occurredAt.getTime() - starts[i - 1]!.occurredAt.getTime() > 3_600_000) sessions++
  }
  return sessions
}

// Activation: real signals only. ≥ 2 sessions AND ≥ 10 song_starts ever.
// Captures "the store actually came back at least once and used it for more
// than a token few songs" — without inventing duration numbers.
const ACTIVATION_MIN_SESSIONS = 2
const ACTIVATION_MIN_SONGS = 10
function isActivated(songStarts: number, sessions: number): boolean {
  return sessions >= ACTIVATION_MIN_SESSIONS && songStarts >= ACTIVATION_MIN_SONGS
}

export const adminRetentionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/retention', async (req, reply) => {
    const op = await requireAdmin(req, reply)
    if (!op) return

    const raw = parseInt((req.query as Record<string, string>).windowDays ?? '28', 10)
    const windowDays = ([7, 14, 28, 90] as const).includes(raw as 7 | 14 | 28 | 90) ? raw : 28

    const now = new Date()
    const windowStart = new Date(now.getTime() - windowDays * 86_400_000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000)

    const [stores, allStarts, allCompletes, windowSkips] = await Promise.all([
      prisma.store.findMany({
        where: { archivedAt: null },
        select: {
          id: true, name: true, createdAt: true,
          tier: true, compTier: true, compExpiresAt: true,
          client: { select: { companyName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // All song_start events ever — drives lastPlayAt, status, sessions, activation
      prisma.playbackEvent.findMany({
        where: { eventType: 'song_start' },
        select: { storeId: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
      // All song_complete events ever — real completion count
      prisma.playbackEvent.findMany({
        where: { eventType: 'song_complete' },
        select: { storeId: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
      // Window skips for skip rate
      prisma.playbackEvent.findMany({
        where: { eventType: 'song_skip', occurredAt: { gte: windowStart } },
        select: { storeId: true },
      }),
    ])

    // Group by store
    const startsByStore = new Map<string, { occurredAt: Date }[]>()
    for (const e of allStarts) {
      const arr = startsByStore.get(e.storeId) ?? []
      arr.push({ occurredAt: e.occurredAt })
      startsByStore.set(e.storeId, arr)
    }

    const completesByStore = new Map<string, { occurredAt: Date }[]>()
    for (const e of allCompletes) {
      const arr = completesByStore.get(e.storeId) ?? []
      arr.push({ occurredAt: e.occurredAt })
      completesByStore.set(e.storeId, arr)
    }

    const skipCountByStore = new Map<string, number>()
    for (const e of windowSkips) {
      skipCountByStore.set(e.storeId, (skipCountByStore.get(e.storeId) ?? 0) + 1)
    }

    const storeRows = stores.map((store) => {
      const tier = effectiveTier(store)
      const allTimeStarts = startsByStore.get(store.id) ?? []
      const allTimeCompletes = completesByStore.get(store.id) ?? []

      // Last play — arrays are sorted asc, last element is latest
      const lastStart = allTimeStarts.length > 0
        ? allTimeStarts[allTimeStarts.length - 1]!.occurredAt
        : null

      let status: 'active' | 'quiet' | 'gone_dark' | 'never_played'
      if (!lastStart) status = 'never_played'
      else if (lastStart >= sevenDaysAgo) status = 'active'
      else if (lastStart >= fourteenDaysAgo) status = 'quiet'
      else status = 'gone_dark'

      // Activation: all-time real signals
      const allTimeSessions = countSessions(allTimeStarts)
      const activated = isActivated(allTimeStarts.length, allTimeSessions)

      // Window metrics — all real counts
      const windowStarts = allTimeStarts.filter((e) => e.occurredAt >= windowStart)
      const windowCompletes = allTimeCompletes.filter((e) => e.occurredAt >= windowStart)
      const skipsInWindow = skipCountByStore.get(store.id) ?? 0
      const skipDenominator = skipsInWindow + windowCompletes.length
      const skipRate = skipDenominator > 0 ? skipsInWindow / skipDenominator : 0
      const sessionsInWindow = countSessions(windowStarts)

      return {
        storeId: store.id,
        storeName: store.name,
        clientName: store.client.companyName,
        tier,
        createdAt: store.createdAt.toISOString(),
        lastPlayAt: lastStart ? lastStart.toISOString() : null,
        songsStarted: windowStarts.length,
        songsCompleted: windowCompletes.length,
        sessionsInWindow,
        skipRate: parseFloat(skipRate.toFixed(4)),
        activated,
        status,
      }
    })

    const overview = {
      totalStores: storeRows.length,
      activeStores: storeRows.filter((s) => s.status === 'active').length,
      activatedStores: storeRows.filter((s) => s.activated).length,
      goneDarkStores: storeRows.filter((s) => s.status === 'gone_dark').length,
      freeStores: storeRows.filter((s) => s.tier === 'free').length,
      paidStores: storeRows.filter((s) => ['core', 'pro', 'enterprise'].includes(s.tier)).length,
    }

    const cohortMap = new Map<string, { signups: number; activated: number; convertedToPaid: number; stillActive: number }>()
    for (let i = 0; i < stores.length; i++) {
      const store = stores[i]!
      const week = isoWeek(store.createdAt)
      const sr = storeRows[i]!
      const row = cohortMap.get(week) ?? { signups: 0, activated: 0, convertedToPaid: 0, stillActive: 0 }
      row.signups++
      if (sr.activated) row.activated++
      if (['core', 'pro', 'enterprise'].includes(sr.tier)) row.convertedToPaid++
      if (sr.status === 'active') row.stillActive++
      cohortMap.set(week, row)
    }

    const cohorts = Array.from(cohortMap.entries())
      .map(([cohortWeek, data]) => ({ cohortWeek, ...data }))
      .sort((a, b) => b.cohortWeek.localeCompare(a.cohortWeek))

    reply.send({
      generatedAt: now.toISOString(),
      windowDays,
      activationCriteria: {
        minSessions: ACTIVATION_MIN_SESSIONS,
        minSongStarts: ACTIVATION_MIN_SONGS,
      },
      overview,
      stores: storeRows,
      cohorts,
    })
  })
}
