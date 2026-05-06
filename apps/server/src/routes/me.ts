// Customer-dashboard /me/* endpoints. Operate on the authed Client (the
// session middleware resolves req.account = Client post-merger). Distinct
// from Operator/admin routes; everything here is gated by requireAuth and
// scoped to a single Client.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { requireAuth } from '../lib/session.js'
import { effectiveTier, compIsActive, tierRank } from '../lib/tier.js'

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
// surfaces (e.g. Brand Intake). Picks the highest-*effective*-tier active
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
  // GET /me/stores — list of Stores for the authed Client.
  // Includes a flat subscription summary so the dashboard can render tier,
  // pause state, and renewal date in one round-trip.
  app.get('/stores', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    const stores = await prisma.store.findMany({
      where: { clientId: ctx.clientId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { subscription: true },
    })

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
      where: { storeId: store.id, archivedAt: null },
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
      storeId: store.id,
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

    const existing = await prisma.iCP.findFirst({
      where: { storeId: store.id, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })

    const saved = existing
      ? await prisma.iCP.update({ where: { id: existing.id }, data: fields })
      : await prisma.iCP.create({ data: fields })

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
        where: { storeId: store.id, archivedAt: null },
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
        storeId: store.id,
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

      const existing = await prisma.iCP.findFirst({
        where: { storeId: store.id },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })

      const saved = existing
        ? await prisma.iCP.update({ where: { id: existing.id }, data: fields })
        : await prisma.iCP.create({ data: fields })

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
        where: { storeId: store.id, archivedAt: null },
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
          storeId: store.id,
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

  function timeToHHMM(d: Date): string {
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  }
  function hhmmToTime(s: string): Date {
    const [h, m] = s.split(':').map(Number)
    const d = new Date(0); d.setUTCHours(h!, m!, 0, 0); return d
  }
  function hhmmToSec(s: string): number {
    const [h, m] = s.split(':').map(Number); return (h! * 60 + m!) * 60
  }

  const ScheduleBody = z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    outcomeId: z.string().uuid(),
  })

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
    const store = await prisma.store.findFirst({ where: { id: storeId, clientId: ctx.clientId, archivedAt: null }, select: { id: true } })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const parsed = ScheduleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    const newStart = hhmmToSec(parsed.data.startTime), newEnd = hhmmToSec(parsed.data.endTime)
    const existing = await prisma.scheduleSlot.findMany({ where: { storeId, dayOfWeek: parsed.data.dayOfWeek } })
    const clash = existing.find((s) => newStart < hhmmToSec(timeToHHMM(s.endTime)) && hhmmToSec(timeToHHMM(s.startTime)) < newEnd)
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
    const parsed = ScheduleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const current = await prisma.scheduleSlot.findUnique({
      where: { id },
      include: { store: { select: { clientId: true } } },
    })
    if (!current || current.store.clientId !== ctx.clientId) return reply.code(404).send({ error: 'not_found' })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    const updStart = hhmmToSec(parsed.data.startTime), updEnd = hhmmToSec(parsed.data.endTime)
    const siblings = await prisma.scheduleSlot.findMany({ where: { storeId: current.storeId, dayOfWeek: parsed.data.dayOfWeek, id: { not: id } } })
    const clash = siblings.find((s) => updStart < hhmmToSec(timeToHHMM(s.endTime)) && hhmmToSec(timeToHHMM(s.startTime)) < updEnd)
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
  app.get('/outcomes', { preHandler: requireAuth }, async (_req, reply) => {
    const rows = await prisma.outcome.findMany({
      where: { supersededAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, displayTitle: true },
    })
    return reply.send(rows)
  })
}
