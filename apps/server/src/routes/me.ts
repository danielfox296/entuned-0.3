// Customer-dashboard /me/* endpoints. Operate on the authed Client (the
// session middleware resolves req.account = Client post-merger). Distinct
// from Operator/admin routes; everything here is gated by requireAuth and
// scoped to a single Client.

import { randomBytes } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { requireAuth } from '../lib/session.js'
import { effectiveTier, compIsActive, tierRank, applyTierChange } from '../lib/tier.js'
import { uniqueStoreSlug } from '../lib/account.js'
import { FREE_TIER_ICP_ID } from '../lib/freeTier.js'
import { pickSystemDefaultOutcomeId, isFreeTierAllowedOutcome, getFreeTierAllowedOutcomeIds } from '../lib/outcomes.js'
import {
  timeToHHMM,
  hhmmToTime,
  hhmmToSec,
  ScheduleSlotBody,
  findOverlappingSlot,
} from '../lib/scheduleSlots.js'

const APPAREL_INDUSTRIES = new Set(['apparel', 'footwear', 'accessories'])

function generateReferralCode(): string {
  return randomBytes(6).toString('base64url').slice(0, 8).toUpperCase()
}

interface AuthedClient {
  clientId: string
}

function getClient(req: FastifyRequest, reply: FastifyReply): AuthedClient | null {
  if (!req.account) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  return { clientId: req.account.id }
}

// "Primary" Store — the Store the dashboard operates on for single-Store
// surfaces (e.g. Customer Profile). Picks the highest-*effective*-tier active
// Store (so a Core store comped to Pro outranks a paid Core sibling), breaks
// ties on createdAt asc. Returns null if the Client has no active Stores.
async function findPrimaryStore(clientId: string) {
  const stores = await prisma.store.findMany({
    where: { clientId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tier: true, compTier: true, compExpiresAt: true, createdAt: true },
  })
  if (stores.length === 0) return null
  return stores.reduce((best, s) =>
    tierRank(effectiveTier(s)) > tierRank(effectiveTier(best)) ? s : best,
  )
}

const IcpInput = z.object({
  name: z.string().trim().min(1).max(120),
  ageRange: z.string().trim().max(120).optional().nullable(),
  location: z.string().trim().max(240).optional().nullable(),
  politicalSpectrum: z.string().trim().max(240).optional().nullable(),
  openness: z.string().trim().max(240).optional().nullable(),
  fears: z.string().trim().max(2000).optional().nullable(),
  values: z.string().trim().max(2000).optional().nullable(),
  desires: z.string().trim().max(2000).optional().nullable(),
  unexpressedDesires: z.string().trim().max(2000).optional().nullable(),
  turnOffs: z.string().trim().max(2000).optional().nullable(),
})


function pickIcpFields(row: {
  id: string
  name: string
  ageRange: string | null
  location: string | null
  politicalSpectrum: string | null
  openness: string | null
  fears: string | null
  values: string | null
  desires: string | null
  unexpressedDesires: string | null
  turnOffs: string | null
  updatedAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    ageRange: row.ageRange,
    location: row.location,
    politicalSpectrum: row.politicalSpectrum,
    openness: row.openness,
    fears: row.fears,
    values: row.values,
    desires: row.desires,
    unexpressedDesires: row.unexpressedDesires,
    turnOffs: row.turnOffs,
    updatedAt: row.updatedAt,
  }
}

export const meRoutes: FastifyPluginAsync = async (app) => {
  // PATCH /me/profile — edit the authed Client's profile fields.
  // Email is intentionally NOT editable here — it's the auth identity, and
  // changing it requires re-verification (separate flow). Everything else
  // the customer can self-serve from the /account page.
  const INDUSTRY_VALUES = [
    'apparel', 'footwear', 'accessories', 'beauty', 'home_decor',
    'sporting_goods', 'food_beverage', 'pet', 'books_media', 'gifts',
    'pharmacy', 'electronics', 'furniture', 'toy', 'other',
  ] as const

  const ProfilePatch = z.object({
    companyName:         z.string().trim().min(1).max(120).optional(),
    contactName:         z.string().trim().max(120).nullable().optional(),
    contactEmail:        z.string().trim().email().max(240).nullable().optional()
                           .or(z.literal('').transform(() => null)),
    contactPhone:        z.string().trim().max(40).nullable().optional(),
    // Onboarding profile
    industry:            z.enum(INDUSTRY_VALUES).optional(),
    zip:                 z.string().trim().regex(/^\d{5}$/, 'Must be a 5-digit zip').optional(),
    // Post-conversion benchmarking
    annualRevenueRange:  z.enum(['under_250k', '250k_500k', '500k_1m', '1m_3m', '3m_plus']).optional(),
    employeeCountRange:  z.enum(['solo', '2_5', '6_15', '16_50', '50_plus']).optional(),
    storeLocationCount:  z.number().int().min(1).max(9999).optional(),
  })
  app.patch('/profile', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return
    const parsed = ProfilePatch.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const data: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) data[k] = v === '' ? null : v
    }
    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'nothing_to_update' })
    }
    const updated = await prisma.client.update({
      where: { id: ctx.clientId },
      data,
      select: {
        id: true, companyName: true,
        contactName: true, contactEmail: true, contactPhone: true,
        industry: true, zip: true,
        annualRevenueRange: true, employeeCountRange: true, storeLocationCount: true,
      },
    })
    return updated
  })

  // GET /me/stores — list of Stores for the authed Client.
  // Includes a flat subscription summary so the dashboard can render tier,
  // pause state, and renewal date in one round-trip.
  app.get('/stores', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    let stores = await prisma.store.findMany({
      where: { clientId: ctx.clientId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { subscription: true },
    })

    // Backstop: every authenticated Client must have ≥1 active Store so the
    // dashboard always has a player URL to surface. ensureFreeClientForUser
    // covers fresh signups, but pre-2026-05-04 sessions can still land here
    // with zero stores. Provision a free Store inline so the user never sees
    // a Locations-tab dead-end.
    if (stores.length === 0) {
      const slug = await uniqueStoreSlug(req.user?.email ?? 'store')
      const defaultOutcomeId = await pickSystemDefaultOutcomeId('free')
      const created = await prisma.store.create({
        data: {
          clientId: ctx.clientId,
          name: 'Main',
          slug,
          tier: 'free',
          defaultOutcomeId,
          // UTC default — the dashboard prompts the user to pick a tz.
          timezone: 'UTC',
        },
      })
      // Backfilled free Store joins the canonical Free Tier pool, same as
      // a fresh signup via ensureFreeClientForUser.
      await prisma.storeICP.create({
        data: { storeId: created.id, icpId: FREE_TIER_ICP_ID },
      })
      stores = await prisma.store.findMany({
        where: { clientId: ctx.clientId, archivedAt: null },
        orderBy: { createdAt: 'asc' },
        include: { subscription: true },
      })
    }

    const rows = stores.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      // `tier` is the *effective* tier — paid tier or comp tier, whichever
      // ranks higher. This is what gates dashboard features. Stripe-paid
      // tier is exposed separately as `paidTier` so the customer-facing
      // billing UI can render "Core ($99/mo, comped to Pro through Aug 12)".
      tier: effectiveTier(s),
      paidTier: s.tier,
      compTier: compIsActive(s) ? s.compTier : null,
      compExpiresAt: compIsActive(s) ? s.compExpiresAt : null,
      pausedUntil: s.pausedUntil,
      subscription: s.subscription
        ? {
            status: s.subscription.status,
            currentPeriodEnd: s.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: s.subscription.cancelAtPeriodEnd,
          }
        : null,
    }))

    return reply.send({ stores: rows })
  })

  // GET /me/icp — current ICP for the authed Client's primary Store.
  // Returns { icp: null, store: null } if the Client has no active Stores or
  // no ICP has been saved yet. Multi-Store Clients see only the primary Store's
  // ICP for now; per-Store intake selection is a v2 concern.
  app.get('/icp', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    const store = await findPrimaryStore(ctx.clientId)
    if (!store) return reply.send({ icp: null, store: null })

    const icp = await prisma.iCP.findFirst({
      where: { storeLinks: { some: { storeId: store.id } }, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    })

    return reply.send({
      icp: icp ? pickIcpFields(icp) : null,
      store: { id: store.id },
    })
  })

  // POST /me/icp — upsert the ICP for the authed Client's primary Store.
  // First save creates a row; subsequent saves update the most recent row in
  // place. Operator-side ICP suggestions, hooks, and reference tracks survive
  // an update because they hang off icp.id and the row identity is preserved.
  app.post('/icp', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    const parsed = IcpInput.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues })
    }

    const store = await findPrimaryStore(ctx.clientId)
    if (!store) return reply.code(409).send({ error: 'no_active_store' })

    const fields = {
      clientId: ctx.clientId,
      name: parsed.data.name,
      ageRange: parsed.data.ageRange ?? null,
      location: parsed.data.location ?? null,
      politicalSpectrum: parsed.data.politicalSpectrum ?? null,
      openness: parsed.data.openness ?? null,
      fears: parsed.data.fears ?? null,
      values: parsed.data.values ?? null,
      desires: parsed.data.desires ?? null,
      unexpressedDesires: parsed.data.unexpressedDesires ?? null,
      turnOffs: parsed.data.turnOffs ?? null,
    }

    // clientId filter is load-bearing: free-tier Stores are StoreICP-linked to
    // the shared FREE_TIER_ICP singleton (clientId = FREE_TIER_CLIENT_ID).
    // Without this filter, the singleton matches and gets clobbered globally.
    const existing = await prisma.iCP.findFirst({
      where: { storeLinks: { some: { storeId: store.id } }, clientId: ctx.clientId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })

    const saved = existing
      ? await prisma.iCP.update({ where: { id: existing.id }, data: fields })
      : await prisma.iCP.create({
          data: { ...fields, storeLinks: { create: { storeId: store.id } } },
        })

    return reply.send({ icp: pickIcpFields(saved) })
  })

  // GET /me/stores/:storeId/icp — ICP for a specific Store.
  // Explicit per-store alternative to GET /me/icp (which always resolves the
  // primary store). Multi-location clients use this to load each store's ICP.
  app.get<{ Params: { storeId: string } }>(
    '/stores/:storeId/icp',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const store = await prisma.store.findFirst({
        where: { id: req.params.storeId, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!store) return reply.code(404).send({ error: 'store_not_found' })

      const icp = await prisma.iCP.findFirst({
        where: { storeLinks: { some: { storeId: store.id } }, archivedAt: null },
        orderBy: { updatedAt: 'desc' },
      })

      return reply.send({ icp: icp ? pickIcpFields(icp) : null, store: { id: store.id } })
    },
  )

  // POST /me/stores/:storeId/icp — upsert ICP for a specific Store.
  app.post<{ Params: { storeId: string } }>(
    '/stores/:storeId/icp',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const store = await prisma.store.findFirst({
        where: { id: req.params.storeId, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!store) return reply.code(404).send({ error: 'store_not_found' })

      const parsed = IcpInput.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues })
      }

      const fields = {
        clientId: ctx.clientId,
        name: parsed.data.name,
        ageRange: parsed.data.ageRange ?? null,
        location: parsed.data.location ?? null,
        politicalSpectrum: parsed.data.politicalSpectrum ?? null,
        openness: parsed.data.openness ?? null,
        fears: parsed.data.fears ?? null,
        values: parsed.data.values ?? null,
        desires: parsed.data.desires ?? null,
        unexpressedDesires: parsed.data.unexpressedDesires ?? null,
        turnOffs: parsed.data.turnOffs ?? null,
      }

      // clientId filter is load-bearing: see POST /icp above.
      const existing = await prisma.iCP.findFirst({
        where: { storeLinks: { some: { storeId: store.id } }, clientId: ctx.clientId, archivedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })

      const saved = existing
        ? await prisma.iCP.update({ where: { id: existing.id }, data: fields })
        : await prisma.iCP.create({
            data: { ...fields, storeLinks: { create: { storeId: store.id } } },
          })

      return reply.send({ icp: pickIcpFields(saved) })
    },
  )

  // GET /me/stores/:storeId/icps — list all non-archived audiences for a Store.
  // Pro feature: a Store may have multiple ICPs (Gary, Jen, etc). Each entry
  // includes its live song count so the dashboard can show "142 songs" per
  // audience without a second round-trip.
  app.get<{ Params: { storeId: string } }>(
    '/stores/:storeId/icps',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const store = await prisma.store.findFirst({
        where: { id: req.params.storeId, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!store) return reply.code(404).send({ error: 'store_not_found' })

      const icps = await prisma.iCP.findMany({
        where: { storeLinks: { some: { storeId: store.id } }, archivedAt: null },
        orderBy: { createdAt: 'asc' },
      })

      // Active LineageRow counts per ICP, batched to avoid N+1.
      const counts = icps.length
        ? await prisma.lineageRow.groupBy({
            by: ['icpId'],
            where: { icpId: { in: icps.map((i) => i.id) }, active: true },
            _count: { _all: true },
          })
        : []
      const countByIcp = new Map(counts.map((c) => [c.icpId, c._count._all]))

      return reply.send({
        icps: icps.map((i) => ({ ...pickIcpFields(i), songCount: countByIcp.get(i.id) ?? 0 })),
      })
    },
  )

  // POST /me/stores/:storeId/icps — create a new audience for a Store.
  // Distinct from POST /me/stores/:storeId/icp (singular), which is the Core
  // upsert. This always creates a new row, supporting Pro's multi-audience model.
  app.post<{ Params: { storeId: string } }>(
    '/stores/:storeId/icps',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const store = await prisma.store.findFirst({
        where: { id: req.params.storeId, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!store) return reply.code(404).send({ error: 'store_not_found' })

      const parsed = IcpInput.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues })
      }

      const created = await prisma.iCP.create({
        data: {
          clientId: ctx.clientId,
          name: parsed.data.name,
          ageRange: parsed.data.ageRange ?? null,
          location: parsed.data.location ?? null,
          politicalSpectrum: parsed.data.politicalSpectrum ?? null,
          openness: parsed.data.openness ?? null,
          fears: parsed.data.fears ?? null,
          values: parsed.data.values ?? null,
          desires: parsed.data.desires ?? null,
          unexpressedDesires: parsed.data.unexpressedDesires ?? null,
          turnOffs: parsed.data.turnOffs ?? null,
          storeLinks: { create: { storeId: store.id } },
        },
      })

      return reply.send({ icp: pickIcpFields(created) })
    },
  )

  // PUT /me/icps/:icpId — update a specific audience by id.
  // Validates the ICP belongs to one of the client's stores before writing.
  app.put<{ Params: { icpId: string } }>(
    '/icps/:icpId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const target = await prisma.iCP.findFirst({
        where: { id: req.params.icpId, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!target) return reply.code(404).send({ error: 'icp_not_found' })

      const parsed = IcpInput.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues })
      }

      const saved = await prisma.iCP.update({
        where: { id: target.id },
        data: {
          name: parsed.data.name,
          ageRange: parsed.data.ageRange ?? null,
          location: parsed.data.location ?? null,
          politicalSpectrum: parsed.data.politicalSpectrum ?? null,
          openness: parsed.data.openness ?? null,
          fears: parsed.data.fears ?? null,
          values: parsed.data.values ?? null,
          desires: parsed.data.desires ?? null,
          unexpressedDesires: parsed.data.unexpressedDesires ?? null,
          turnOffs: parsed.data.turnOffs ?? null,
        },
      })

      return reply.send({ icp: pickIcpFields(saved) })
    },
  )

  // POST /me/icps/:icpId/retire — soft-delete an audience and deactivate its
  // LineageRows so its songs stop playing. Rows are preserved so the audience
  // and its library can be restored later (no public unretire endpoint yet —
  // operator-side until we see real demand for self-service restore).
  app.post<{ Params: { icpId: string } }>(
    '/icps/:icpId/retire',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const target = await prisma.iCP.findFirst({
        where: { id: req.params.icpId, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!target) return reply.code(404).send({ error: 'icp_not_found' })

      const now = new Date()
      await prisma.$transaction([
        prisma.iCP.update({
          where: { id: target.id },
          data: { archivedAt: now },
        }),
        prisma.lineageRow.updateMany({
          where: { icpId: target.id, active: true },
          data: { active: false },
        }),
      ])

      return reply.send({ ok: true, archivedAt: now.toISOString() })
    },
  )

  // PATCH /me/stores/:id — rename a Store. Only writes to `Store.name`. The
  // slug stays put — it's the URL the customer has likely shared, and we
  // never want a rename to break a music.entuned.co/<slug> link.
  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/stores/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const { id } = req.params
      const parsed = z.object({
        name: z.string().trim().min(1).max(120),
      }).safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues })
      }

      const store = await prisma.store.findFirst({
        where: { id, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!store) return reply.code(404).send({ error: 'store_not_found' })

      const updated = await prisma.store.update({
        where: { id: store.id },
        data: { name: parsed.data.name },
        select: { id: true, name: true },
      })

      return reply.send({ store: updated })
    },
  )

  // ----- Schedule (customer-facing, scoped to client's stores) -----
  // Time helpers + ScheduleSlotBody schema live in ../lib/scheduleSlots.js
  // (shared with /admin/* routes — see ASSESSMENT.md §2.2).

  function fmtSlot(r: { id: string; storeId: string; dayOfWeek: number; startTime: Date; endTime: Date; outcomeId: string; outcome: { title: string; displayTitle: string | null } }) {
    return {
      id: r.id, storeId: r.storeId, dayOfWeek: r.dayOfWeek,
      startTime: timeToHHMM(r.startTime), endTime: timeToHHMM(r.endTime),
      outcomeId: r.outcomeId, outcomeTitle: r.outcome.title, outcomeDisplayTitle: r.outcome.displayTitle,
    }
  }

  app.get('/stores/:storeId/schedule', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return
    const storeId = (req.params as any).storeId as string
    const store = await prisma.store.findFirst({ where: { id: storeId, clientId: ctx.clientId, archivedAt: null }, select: { id: true } })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const rows = await prisma.scheduleSlot.findMany({
      where: { storeId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: { outcome: { select: { title: true, displayTitle: true } } },
    })
    return reply.send(rows.map(fmtSlot))
  })

  app.post('/stores/:storeId/schedule', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return
    const storeId = (req.params as any).storeId as string
    const store = await prisma.store.findFirst({
      where: { id: storeId, clientId: ctx.clientId, archivedAt: null },
      select: { id: true, tier: true, compTier: true, compExpiresAt: true },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const parsed = ScheduleSlotBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    // Free-tier guard: schedule slots may only reference allowlisted outcomes
    // (same rule as the admin schedule routes and the player selection route).
    // effectiveTier so a comped store keeps paid privileges while the comp runs.
    if (effectiveTier(store) === 'free' && !(await isFreeTierAllowedOutcome(parsed.data.outcomeId))) {
      return reply.code(409).send({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
    }
    const existing = await prisma.scheduleSlot.findMany({ where: { storeId, dayOfWeek: parsed.data.dayOfWeek } })
    const clash = findOverlappingSlot(parsed.data, existing)
    if (clash) return reply.code(409).send({ error: 'schedule_overlap', message: `Overlaps with ${timeToHHMM(clash.startTime)}–${timeToHHMM(clash.endTime)}` })
    const row = await prisma.scheduleSlot.create({
      data: { storeId, dayOfWeek: parsed.data.dayOfWeek, startTime: hhmmToTime(parsed.data.startTime), endTime: hhmmToTime(parsed.data.endTime), outcomeId: parsed.data.outcomeId },
      include: { outcome: { select: { title: true, displayTitle: true } } },
    })
    return reply.code(201).send(fmtSlot(row))
  })

  app.put('/schedule-rows/:id', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return
    const id = (req.params as any).id as string
    const parsed = ScheduleSlotBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const current = await prisma.scheduleSlot.findUnique({
      where: { id },
      include: { store: { select: { clientId: true, tier: true, compTier: true, compExpiresAt: true } } },
    })
    if (!current || current.store.clientId !== ctx.clientId) return reply.code(404).send({ error: 'not_found' })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    // Free-tier guard — same rule as create.
    if (effectiveTier(current.store) === 'free' && !(await isFreeTierAllowedOutcome(parsed.data.outcomeId))) {
      return reply.code(409).send({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
    }
    const siblings = await prisma.scheduleSlot.findMany({ where: { storeId: current.storeId, dayOfWeek: parsed.data.dayOfWeek, id: { not: id } } })
    const clash = findOverlappingSlot(parsed.data, siblings)
    if (clash) return reply.code(409).send({ error: 'schedule_overlap', message: `Overlaps with ${timeToHHMM(clash.startTime)}–${timeToHHMM(clash.endTime)}` })
    const row = await prisma.scheduleSlot.update({
      where: { id },
      data: { dayOfWeek: parsed.data.dayOfWeek, startTime: hhmmToTime(parsed.data.startTime), endTime: hhmmToTime(parsed.data.endTime), outcomeId: parsed.data.outcomeId },
      include: { outcome: { select: { title: true, displayTitle: true } } },
    })
    return reply.send(fmtSlot(row))
  })

  app.delete('/schedule-rows/:id', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return
    const id = (req.params as any).id as string
    const current = await prisma.scheduleSlot.findUnique({
      where: { id },
      include: { store: { select: { clientId: true } } },
    })
    if (!current || current.store.clientId !== ctx.clientId) return reply.code(404).send({ error: 'not_found' })
    await prisma.scheduleSlot.delete({ where: { id } })
    return reply.send({ ok: true })
  })

  // GET /me/outcomes — active outcomes list, for the schedule slot outcome picker.
  // Annotated with availableOnFree so the dashboard can filter/lock the picker
  // for free-tier stores (mirrors GET /hendrix/outcomes).
  app.get('/outcomes', { preHandler: requireAuth }, async (_req, reply) => {
    const [rows, allowedIds] = await Promise.all([
      prisma.outcome.findMany({
        where: { supersededAt: null },
        orderBy: { title: 'asc' },
        select: { id: true, title: true, displayTitle: true },
      }),
      getFreeTierAllowedOutcomeIds(),
    ])
    return reply.send(rows.map((r) => ({ ...r, availableOnFree: allowedIds.has(r.id) })))
  })

  // POST /me/boost-trial — submit the onboarding ICP form and activate the
  // Boost Trial comp. Creates an ICP with source='onboarding', links it to the
  // free Store, and sets compTier='core' (clock starts when first song is live).
  const BoostTrialBody = z.object({
    icpAgeCenter:        z.enum(['under_25', '25_34', '35_44', '45_54', '55_plus']),
    icpAgeRangeWide:     z.boolean().optional(),
    icpGenderSkew:       z.enum(['mostly_women', 'mostly_men', 'even_mix']),
    icpShoppingMode:     z.enum(['browsing', 'mission', 'mixed']),
    icpStorePersonality: z.enum(['curated', 'energetic', 'warm', 'clean', 'eclectic']),
    icpCurrentMusic:     z.enum(['spotify', 'pandora', 'satellite', 'silence', 'other']),
    icpCurrentMusicOther: z.string().trim().max(120).optional(),
    icpPlaylistRef:      z.string().trim().url().max(500).optional(),
    icpPricePoint:       z.enum(['value', 'mid', 'premium']).optional(),
  })
  app.post('/boost-trial', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return
    const parsed = BoostTrialBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }

    const client = await prisma.client.findUnique({
      where: { id: ctx.clientId },
      select: { id: true, companyName: true, industry: true },
    })
    if (!client) return reply.code(404).send({ error: 'client_not_found' })

    const store = await findPrimaryStore(ctx.clientId)
    if (!store) return reply.code(409).send({ error: 'no_active_store' })

    const fullStore = await prisma.store.findUnique({
      where: { id: store.id },
      select: { id: true, tier: true, compTier: true, compExpiresAt: true },
    })
    if (!fullStore) return reply.code(409).send({ error: 'no_active_store' })

    if (fullStore.tier !== 'free') {
      return reply.code(409).send({ error: 'already_paid', message: 'Store is already on a paid tier.' })
    }
    if (fullStore.compTier) {
      return reply.code(409).send({ error: 'trial_already_active', message: 'A comp is already active on this store.' })
    }

    // icpPricePoint is only meaningful for apparel/footwear; strip it otherwise.
    const pricePoint = client.industry && APPAREL_INDUSTRIES.has(client.industry)
      ? parsed.data.icpPricePoint ?? null
      : null

    const now = new Date()
    const icpName = `${client.companyName} Customers`

    await prisma.$transaction(async (tx) => {
      const icp = await tx.iCP.create({
        data: {
          clientId: ctx.clientId,
          name: icpName,
          source: 'onboarding',
          icpAgeCenter: parsed.data.icpAgeCenter,
          icpAgeRangeWide: parsed.data.icpAgeRangeWide ?? null,
          icpGenderSkew: parsed.data.icpGenderSkew,
          icpShoppingMode: parsed.data.icpShoppingMode,
          icpStorePersonality: parsed.data.icpStorePersonality,
          icpCurrentMusic: parsed.data.icpCurrentMusic,
          icpCurrentMusicOther: parsed.data.icpCurrentMusicOther ?? null,
          icpPlaylistRef: parsed.data.icpPlaylistRef ?? null,
          icpPricePoint: pricePoint,
        },
      })
      await tx.storeICP.create({ data: { storeId: store.id, icpId: icp.id } })
      // Sever the Free Tier ICP link by default — a paying customer's pool
      // should be just their own ICP. Operators can re-link via the Dash
      // Location settings toggle if a client explicitly asks for it.
      await tx.storeICP.deleteMany({
        where: { storeId: store.id, icpId: FREE_TIER_ICP_ID },
      })
      await tx.store.update({
        where: { id: store.id },
        data: {
          compTier: 'core',
          compExpiresAt: null, // clock starts when first song is live
          compReason: 'boost_trial_icp',
          compGrantedAt: now,
          compGrantedById: null,
        },
      })
      await tx.tierChangeLog.create({
        data: {
          storeId: store.id,
          fromTier: 'free',
          toTier: 'core',
          source: 'boost_trial_icp',
          reason: `Boost Trial ICP submitted: ${icpName}`,
        },
      })
    })

    return reply.send({ ok: true, trialStatus: 'generating' })
  })

  // GET /me/boost-trial/status — current Boost Trial state for the primary Store.
  // States: 'none' | 'generating' | 'active' | 'expired'
  app.get('/boost-trial/status', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return

    const store = await findPrimaryStore(ctx.clientId)
    if (!store) return reply.send({ trialStatus: 'none', daysRemaining: null })

    const fullStore = await prisma.store.findUnique({
      where: { id: store.id },
      select: { tier: true, compTier: true, compExpiresAt: true, compReason: true },
    })
    if (!fullStore) return reply.send({ trialStatus: 'none', daysRemaining: null })

    const isBoostTrial = fullStore.compReason === 'boost_trial_icp'

    if (isBoostTrial && fullStore.compTier === 'core') {
      if (!fullStore.compExpiresAt) {
        return reply.send({ trialStatus: 'generating', daysRemaining: null })
      }
      const now = new Date()
      if (fullStore.compExpiresAt > now) {
        const daysRemaining = Math.max(1, Math.ceil((fullStore.compExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        return reply.send({ trialStatus: 'active', daysRemaining })
      }
    }

    // Check TierChangeLog to distinguish 'expired' from 'none'
    const trialLog = await prisma.tierChangeLog.findFirst({
      where: { storeId: store.id, source: 'boost_trial_icp' },
      select: { id: true },
    })
    if (trialLog) return reply.send({ trialStatus: 'expired', daysRemaining: null })

    return reply.send({ trialStatus: 'none', daysRemaining: null })
  })

  // POST /me/referral-code — lazy-generate the Client's referral code.
  // Returns the code whether it was just created or already existed.
  app.post('/referral-code', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply); if (!ctx) return

    const client = await prisma.client.findUnique({
      where: { id: ctx.clientId },
      select: { id: true, referralCode: true },
    })
    if (!client) return reply.code(404).send({ error: 'client_not_found' })

    if (client.referralCode) {
      return reply.send({ referralCode: client.referralCode })
    }

    // Generate a unique 8-char code, retry on collision.
    let code: string | null = null
    for (let i = 0; i < 5; i++) {
      const candidate = generateReferralCode()
      const existing = await prisma.client.findUnique({ where: { referralCode: candidate }, select: { id: true } })
      if (!existing) { code = candidate; break }
    }
    if (!code) return reply.code(500).send({ error: 'code_generation_failed' })

    const updated = await prisma.client.update({
      where: { id: ctx.clientId },
      data: { referralCode: code },
      select: { referralCode: true },
    })
    return reply.send({ referralCode: updated.referralCode })
  })
}
