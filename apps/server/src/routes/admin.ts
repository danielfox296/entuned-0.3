// Admin routes — gated by isAdmin on the operator. Used by apps/admin.
//
// Surface:
//   GET    /admin/musicological-rules            — latest + history
//   POST   /admin/musicological-rules            — new versioned row { rulesText, notes? }
//   GET    /admin/style-exclusion-rules                  — full table
//   POST   /admin/style-exclusion-rules                  — create one
//   PUT    /admin/style-exclusion-rules/:id              — update one
//   DELETE /admin/style-exclusion-rules/:id              — delete one
//   GET    /admin/style-template                 — latest + history (text-only; logic is code)
//   POST   /admin/style-template                 — new versioned row { templateText, notes? }
//   GET    /admin/lyric-prompts                  — { draft: { latest, history }, edit: { latest, history } }
//   POST   /admin/lyric-prompts/draft            — new draft prompt version
//   POST   /admin/lyric-prompts/edit             — new edit prompt version

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { verify } from '../lib/auth.js'
import bcrypt from 'bcryptjs'
import { decompose } from '../lib/decomposer/decomposer.js'
import { nextQueue } from '../lib/hendrix.js'
import { setOverride, clearOverride } from '../lib/outcomeSchedule.js'
import { runEno } from '../lib/eno/eno.js'
import { downloadAndUploadFromUrl } from '../lib/r2.js'
import { draftHooks, getOrSeedHookWriterPrompt } from '../lib/hooks/drafter.js'
import { suggestReferenceTracks } from '../lib/ref-tracks/suggester.js'

interface AuthedOp {
  operatorId: string
  email: string
  isAdmin: boolean
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthedOp | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  const payload = verify(auth.slice(7))
  if (!payload) {
    reply.code(401).send({ error: 'invalid_token' })
    return null
  }
  if (!payload.isAdmin) {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }
  // Re-verify the operator is still active.
  const op = await prisma.operator.findUnique({ where: { id: payload.operatorId } })
  if (!op || op.disabledAt || !op.isAdmin) {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }
  return { operatorId: op.id, email: op.email, isAdmin: op.isAdmin }
}

// Time helpers — Prisma @db.Time(6) round-trips as Date with UTC time portion.
function timeToHHMM(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function hhmmToTime(s: string): Date {
  const padded = s.length === 5 ? `${s}:00` : s
  return new Date(`1970-01-01T${padded}.000Z`)
}

function hhmmToSec(s: string): number {
  const [h, m, sec] = s.split(':').map((x) => parseInt(x, 10))
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0)
}

// Schemas
const RulesPostBody = z.object({ rulesText: z.string().min(1), notes: z.string().optional() })

const StyleExclusionRuleBody = z.object({
  triggerField: z.string().min(1),
  triggerValue: z.string(),
  exclude: z.string().min(1),
  overrideField: z.string().nullable().optional(),
  overridePattern: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

const StyleTemplatePostBody = z.object({ templateText: z.string().min(1), notes: z.string().optional() })

const OutcomePrependPostBody = z.object({ templateText: z.string(), notes: z.string().optional() })

const ReferenceTrackPromptPostBody = z.object({ templateText: z.string().min(1), notes: z.string().optional() })

const LyricPromptPostBody = z.object({ promptText: z.string().min(1), notes: z.string().optional() })

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // ----- MusicologicalRules -----

  app.get('/musicological-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const all = await prisma.styleAnalyzerInstructions.findMany({ orderBy: { version: 'desc' } })
    return { latest: all[0] ?? null, history: all }
  })

  app.post('/musicological-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = RulesPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.styleAnalyzerInstructions.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.styleAnalyzerInstructions.create({
      data: { version: next, rulesText: parsed.data.rulesText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
  })

  // ----- FailureRules -----

  app.get('/style-exclusion-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.styleExclusionRule.findMany({ orderBy: { triggerField: 'asc' } })
    return rows
  })

  app.post('/style-exclusion-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = StyleExclusionRuleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const row = await prisma.styleExclusionRule.create({
      data: {
        triggerField: parsed.data.triggerField,
        triggerValue: parsed.data.triggerValue,
        exclude: parsed.data.exclude,
        overrideField: parsed.data.overrideField ?? null,
        overridePattern: parsed.data.overridePattern ?? null,
        note: parsed.data.note ?? null,
      },
    })
    return row
  })

  app.put('/style-exclusion-rules/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = StyleExclusionRuleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.styleExclusionRule.update({
        where: { id },
        data: {
          triggerField: parsed.data.triggerField,
          triggerValue: parsed.data.triggerValue,
          exclude: parsed.data.exclude,
          overrideField: parsed.data.overrideField ?? null,
          overridePattern: parsed.data.overridePattern ?? null,
          note: parsed.data.note ?? null,
        },
      })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete('/style-exclusion-rules/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await prisma.styleExclusionRule.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ----- StyleTemplate (text/provenance only — logic is code) -----

  app.get('/style-template', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const all = await prisma.styleTemplate.findMany({ orderBy: { version: 'desc' } })
    return { latest: all[0] ?? null, history: all }
  })

  app.post('/style-template', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = StyleTemplatePostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.styleTemplate.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.styleTemplate.create({
      data: { version: next, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
  })

  // ----- Production Eras (lookup for Outcome FK) -----

  app.get('/production-eras', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.productionEra.findMany({
      where: { isActive: true },
      select: { id: true, decade: true, genreSlug: true, genreDisplayName: true },
      orderBy: [{ decade: 'asc' }, { genreSlug: 'asc' }],
    })
    return rows
  })

  // ----- OutcomeFactorPrompt (Card 14 — currently a no-op by design) -----

  app.get('/outcome-factor-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const all = await prisma.outcomeFactorPrompt.findMany({ orderBy: { version: 'desc' } })
    return { latest: all[0] ?? null, history: all }
  })

  app.post('/outcome-factor-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = OutcomePrependPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.outcomeFactorPrompt.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.outcomeFactorPrompt.create({
      data: { version: next, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
  })

  // ----- ReferenceTrackPrompt (system prompt for the ref-track suggester) -----

  app.get('/reference-track-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const all = await prisma.referenceTrackPrompt.findMany({ orderBy: { version: 'desc' } })
    return { latest: all[0] ?? null, history: all }
  })

  app.post('/reference-track-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = ReferenceTrackPromptPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.referenceTrackPrompt.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.referenceTrackPrompt.create({
      data: { version: next, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
  })

  app.post('/icps/:id/suggest-reference-tracks', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const exists = await prisma.iCP.findUnique({ where: { id: icpId }, select: { id: true } })
    if (!exists) return reply.code(404).send({ error: 'icp_not_found' })
    try {
      const result = await suggestReferenceTracks({ icpId })
      return result
    } catch (e: any) {
      return reply.code(500).send({ error: 'suggest_failed', message: e?.message ?? 'unknown' })
    }
  })

  // ----- Lyric prompts (Bernie) -----

  app.get('/lyric-prompts', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const [draftAll, editAll] = await Promise.all([
      prisma.lyricDraftPrompt.findMany({ orderBy: { version: 'desc' } }),
      prisma.lyricEditPrompt.findMany({ orderBy: { version: 'desc' } }),
    ])
    return {
      draft: { latest: draftAll[0] ?? null, history: draftAll },
      edit: { latest: editAll[0] ?? null, history: editAll },
    }
  })

  app.post('/lyric-prompts/draft', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = LyricPromptPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.lyricDraftPrompt.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.lyricDraftPrompt.create({
      data: { version: next, promptText: parsed.data.promptText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
  })

  app.post('/lyric-prompts/edit', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = LyricPromptPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.lyricEditPrompt.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.lyricEditPrompt.create({
      data: { version: next, promptText: parsed.data.promptText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
  })

  // ----- Brand: Stores / ICPs / ReferenceTracks / Decompositions -----

  // ----- Clients (Card 3 Duke) -----

  app.get('/clients', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.client.findMany({
      orderBy: { companyName: 'asc' },
      include: {
        _count: { select: { stores: true, icps: true } },
      },
    })
    return rows.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      plan: c.plan,
      posProvider: c.posProvider,
      brandLyricGuidelines: c.brandLyricGuidelines,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      storeCount: c._count.stores,
      icpCount: c._count.icps,
    }))
  })

  app.get('/clients/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        stores: {
          orderBy: { name: 'asc' },
          include: {
            icps: { select: { id: true, name: true } },
            defaultOutcome: { select: { id: true, title: true, version: true } },
          },
        },
        icps: { orderBy: { name: 'asc' }, select: { id: true, name: true, storeId: true, _count: { select: { hooks: true, referenceTracks: true } } } },
      },
    })
    if (!client) return reply.code(404).send({ error: 'not_found' })
    return {
      id: client.id,
      companyName: client.companyName,
      contactName: client.contactName,
      contactEmail: client.contactEmail,
      contactPhone: client.contactPhone,
      plan: client.plan,
      posProvider: client.posProvider,
      brandLyricGuidelines: client.brandLyricGuidelines,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      stores: client.stores.map((s) => ({
        id: s.id,
        name: s.name,
        timezone: s.timezone,
        goLiveDate: s.goLiveDate ? s.goLiveDate.toISOString().slice(0, 10) : null,
        icps: s.icps.map((i) => ({ id: i.id, name: i.name })),
        defaultOutcome: s.defaultOutcome,
      })),
      icps: client.icps.map((i) => ({
        id: i.id, name: i.name,
        hookCount: i._count.hooks,
        referenceTrackCount: i._count.referenceTracks,
        storeCount: i.storeId ? 1 : 0,
      })),
    }
  })

  const ClientUpdateBody = z.object({
    companyName: z.string().min(1).optional(),
    contactName: z.string().nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    plan: z.enum(['mvp_pilot', 'trial', 'paid_pilot', 'production', 'paused', 'inactive']).optional(),
    posProvider: z.string().nullable().optional(),
    brandLyricGuidelines: z.string().nullable().optional(),
  })

  app.put('/clients/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = ClientUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.client.update({ where: { id }, data: parsed.data as any })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  const ClientCreateBody = z.object({
    companyName: z.string().min(1),
  })

  app.post('/clients', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = ClientCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const row = await prisma.client.create({
      data: { companyName: parsed.data.companyName },
      include: { _count: { select: { stores: true, icps: true } } },
    })
    return reply.code(201).send({
      id: row.id,
      companyName: row.companyName,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      plan: row.plan,
      posProvider: row.posProvider,
      brandLyricGuidelines: row.brandLyricGuidelines,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      storeCount: row._count.stores,
      icpCount: row._count.icps,
    })
  })

  // ----- Store editor (create + update) -----

  const StoreCreateBody = z.object({
    clientId: z.string().uuid(),
    name: z.string().min(1),
    timezone: z.string().min(1),
    goLiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    defaultOutcomeId: z.string().uuid().nullable().optional(),
  })

  app.post('/stores', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = StoreCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.store.create({
        data: {
          clientId: parsed.data.clientId,
          name: parsed.data.name,
          timezone: parsed.data.timezone,
          goLiveDate: parsed.data.goLiveDate ? new Date(parsed.data.goLiveDate) : null,
          defaultOutcomeId: parsed.data.defaultOutcomeId ?? null,
        },
        include: { client: { select: { companyName: true } }, icps: { select: { id: true, name: true } } },
      })
      return {
        id: row.id, name: row.name, timezone: row.timezone,
        clientId: row.clientId, clientName: row.client.companyName,
        icps: row.icps.map((i) => ({ id: i.id, name: i.name })),
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        return reply.code(404).send({ error: 'client_or_outcome_not_found' })
      }
      throw e
    }
  })

  const StoreUpdateBody = z.object({
    name: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    goLiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    defaultOutcomeId: z.string().uuid().nullable().optional(),
  })

  app.put('/stores/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = StoreUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const data: any = { ...parsed.data }
    if (parsed.data.goLiveDate !== undefined) {
      data.goLiveDate = parsed.data.goLiveDate ? new Date(parsed.data.goLiveDate) : null
    }
    try {
      const row = await prisma.store.update({
        where: { id }, data,
        include: { client: { select: { companyName: true } }, icps: { select: { id: true, name: true } } },
      })
      return {
        id: row.id, name: row.name, timezone: row.timezone,
        clientId: row.clientId, clientName: row.client.companyName,
        icps: row.icps.map((i) => ({ id: i.id, name: i.name })),
        goLiveDate: row.goLiveDate ? row.goLiveDate.toISOString().slice(0, 10) : null,
        defaultOutcomeId: row.defaultOutcomeId,
      }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.get('/stores', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.store.findMany({
      orderBy: [{ client: { companyName: 'asc' } }, { name: 'asc' }],
      include: { client: { select: { companyName: true } }, icps: { select: { id: true, name: true } } },
    })
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      timezone: s.timezone,
      clientId: s.clientId,
      clientName: s.client.companyName,
      icps: s.icps.map((i) => ({ id: i.id, name: i.name })),
    }))
  })

  app.get('/stores/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const store = await prisma.store.findUnique({
      where: { id },
      include: { client: { select: { id: true, companyName: true } } },
    })
    if (!store) return reply.code(404).send({ error: 'not_found' })
    const icps = await prisma.iCP.findMany({
      where: { storeId: id },
      include: {
        referenceTracks: {
          orderBy: [{ bucket: 'asc' }, { status: 'desc' }, { artist: 'asc' }, { title: 'asc' }],
          include: { styleAnalysis: true },
        },
      },
    })
    return {
      store: {
        id: store.id,
        name: store.name,
        timezone: store.timezone,
        clientId: store.client.id,
        clientName: store.client.companyName,
        goLiveDate: store.goLiveDate ? store.goLiveDate.toISOString().slice(0, 10) : null,
        defaultOutcomeId: store.defaultOutcomeId,
      },
      icps,
      sharedWith: [],
    }
  })

  // ----- ICP: create (location-scoped) + update -----

  const IcpCreateBody = z.object({
    storeId: z.string().uuid(),
    name: z.string().min(1),
  })

  app.post('/icps', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = IcpCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const store = await prisma.store.findUnique({ where: { id: parsed.data.storeId } })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    try {
      const row = await prisma.iCP.create({
        data: { storeId: parsed.data.storeId, clientId: store.clientId, name: parsed.data.name },
      })
      return reply.code(201).send(row)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        return reply.code(404).send({ error: 'store_not_found' })
      }
      throw e
    }
  })

  // --- ICP psychographic-field updates (no versioning yet — schema is updatedAt-based) ---
  const IcpUpdateBody = z.object({
    name: z.string().min(1).optional(),
    ageRange: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    politicalSpectrum: z.string().nullable().optional(),
    openness: z.string().nullable().optional(),
    fears: z.string().nullable().optional(),
    values: z.string().nullable().optional(),
    desires: z.string().nullable().optional(),
    unexpressedDesires: z.string().nullable().optional(),
    turnOffs: z.string().nullable().optional(),
  })

  app.put('/icps/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = IcpUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.iCP.update({ where: { id }, data: parsed.data })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // --- Reference tracks ---
  const RefTrackBody = z.object({
    bucket: z.enum(['FormationEra', 'Subculture', 'Aspirational']),
    artist: z.string().min(1),
    title: z.string().min(1),
    year: z.number().int().nullable().optional(),
    operatorNotes: z.string().nullable().optional(),
  })

  app.post('/icps/:id/reference-tracks', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const parsed = RefTrackBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.referenceTrack.create({
        data: {
          icpId,
          bucket: parsed.data.bucket,
          artist: parsed.data.artist,
          title: parsed.data.title,
          year: parsed.data.year ?? null,
          operatorNotes: parsed.data.operatorNotes ?? null,
        },
      })
      return row
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        return reply.code(404).send({ error: 'icp_not_found' })
      }
      throw e
    }
  })

  app.put('/reference-tracks/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = RefTrackBody.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.referenceTrack.update({ where: { id }, data: parsed.data })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete('/reference-tracks/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await prisma.referenceTrack.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // --- Approve a pending (suggested) reference track. Flips status to approved. ---
  app.post('/reference-tracks/:id/approve', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      const row = await prisma.referenceTrack.update({
        where: { id },
        data: { status: 'approved', approvedAt: new Date(), approvedById: op.operatorId },
      })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // --- Decompose now: runs Claude with web search; upserts StyleAnalysis row. ---
  // Always overwrites the existing draft; verified rows return 409 unless ?force=1.
  // Pending suggestions cannot be decomposed — approve first.
  app.post('/reference-tracks/:id/decompose', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const force = (req.query as any)?.force === '1'
    const ref = await prisma.referenceTrack.findUnique({
      where: { id },
      include: { styleAnalysis: true },
    })
    if (!ref) return reply.code(404).send({ error: 'not_found' })
    if (ref.status === 'pending') {
      return reply.code(409).send({ error: 'pending_reference_track', message: 'Approve the suggestion before decomposing.' })
    }
    if (ref.styleAnalysis && ref.styleAnalysis.status === 'verified' && !force) {
      return reply.code(409).send({ error: 'verified_style_analysis_exists', message: 'Pass ?force=1 to overwrite a verified decomposition.' })
    }
    let result
    try {
      result = await decompose({
        artist: ref.artist,
        title: ref.title,
        year: ref.year ?? undefined,
        operatorNotes: ref.operatorNotes ?? undefined,
      })
    } catch (e: any) {
      return reply.code(502).send({ error: 'decompose_failed', message: e.message ?? 'unknown' })
    }
    const data = {
      styleAnalyzerInstructionsVersion: result.rulesVersion,
      status: 'draft',
      verifiedAt: null,
      verifiedById: null,
      confidence: result.output.confidence,
      vibePitch: result.output.vibe_pitch,
      eraProductionSignature: result.output.era_production_signature,
      instrumentationPalette: result.output.instrumentation_palette,
      standoutElement: result.output.standout_element,
      arrangementShape: result.output.arrangement_shape,
      dynamicCurve: result.output.dynamic_curve,
      vocalCharacter: result.output.vocal_character,
      vocalArrangement: result.output.vocal_arrangement,
      harmonicAndGroove: result.output.harmonic_and_groove,
    }
    const row = await prisma.styleAnalysis.upsert({
      where: { referenceTrackId: id },
      create: { referenceTrackId: id, ...data },
      update: data,
    })
    return row
  })

  // --- Hand-edit a StyleAnalysis. status drives draft/verified lifecycle. ---
  const DecompositionUpdateBody = z.object({
    status: z.enum(['draft', 'verified']).optional(),
    confidence: z.enum(['low', 'medium', 'high']).nullable().optional(),
    vibePitch: z.string().nullable().optional(),
    eraProductionSignature: z.string().nullable().optional(),
    instrumentationPalette: z.string().nullable().optional(),
    standoutElement: z.string().nullable().optional(),
    arrangementShape: z.string().nullable().optional(),
    dynamicCurve: z.string().nullable().optional(),
    vocalCharacter: z.string().nullable().optional(),
    vocalArrangement: z.string().nullable().optional(),
    harmonicAndGroove: z.string().nullable().optional(),
  })

  // ----- Outcomes (read-only list for hook picker etc.) -----

  app.get('/outcomes', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const includeSuperseded = (req.query as any)?.include === 'all'
    const rows = await prisma.outcome.findMany({
      where: includeSuperseded ? {} : { supersededAt: null },
      orderBy: [{ title: 'asc' }, { version: 'desc' }],
      include: { productionEra: { select: { id: true, decade: true, genreSlug: true, genreDisplayName: true } } },
    })
    if (!includeSuperseded) return rows
    // For library view: include global active LineageRow counts per outcome.
    const counts = await prisma.lineageRow.groupBy({
      by: ['outcomeId'],
      where: { active: true },
      _count: { _all: true },
    })
    const countMap = new Map(counts.map((c) => [c.outcomeId, c._count._all]))
    return rows.map((o) => ({ ...o, lineageCount: countMap.get(o.id) ?? 0 }))
  })

  // ----- Outcomes (Card 09 copy-on-write versioning) -----

  const OutcomeCreateBody = z.object({
    title: z.string().min(1),
    tempoBpm: z.number().int().min(40).max(220),
    mode: z.string().min(1),
    dynamics: z.string().nullable().optional(),
    instrumentation: z.string().nullable().optional(),
    familiarity: z.string().nullable().optional(),
    productionEraId: z.string().uuid().nullable().optional(),
  })

  app.post('/outcomes', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = OutcomeCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const row = await prisma.outcome.create({
      data: {
        outcomeKey: crypto.randomUUID(),
        version: 1,
        title: parsed.data.title,
        tempoBpm: parsed.data.tempoBpm,
        mode: parsed.data.mode,
        dynamics: parsed.data.dynamics ?? null,
        instrumentation: parsed.data.instrumentation ?? null,
        familiarity: parsed.data.familiarity ?? null,
        productionEraId: parsed.data.productionEraId ?? null,
        createdById: op.operatorId,
      },
      include: { productionEra: { select: { id: true, decade: true, genreSlug: true, genreDisplayName: true } } },
    })
    return row
  })

  // PUT = create new version with same outcomeKey, supersede the old.
  // Existing references (hooks, schedule rows, submissions, lineage rows) stay pinned to the old id.
  app.put('/outcomes/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = OutcomeCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const existing = await prisma.outcome.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.supersededAt) return reply.code(409).send({ error: 'already_superseded', message: 'Edit the latest active version of this outcome key.' })
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.outcome.update({ where: { id }, data: { supersededAt: new Date() } })
        const created = await tx.outcome.create({
          data: {
            outcomeKey: existing.outcomeKey,
            version: existing.version + 1,
            title: parsed.data.title,
            tempoBpm: parsed.data.tempoBpm,
            mode: parsed.data.mode,
            dynamics: parsed.data.dynamics ?? null,
            instrumentation: parsed.data.instrumentation ?? null,
            familiarity: parsed.data.familiarity ?? null,
            productionEraId: parsed.data.productionEraId ?? null,
            createdById: op.operatorId,
          },
          include: { productionEra: { select: { id: true, decade: true, genreSlug: true, genreDisplayName: true } } },
        })
        return created
      })
      return result
    } catch (e: any) {
      return reply.code(500).send({ error: 'edit_failed', message: e.message ?? 'unknown' })
    }
  })

  app.post('/outcomes/:id/supersede', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.outcome.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.supersededAt) return existing
    const row = await prisma.outcome.update({ where: { id }, data: { supersededAt: new Date() } })
    return row
  })

  // ----- Pool Depth (per-(ICP, Outcome) active LineageRow counts) -----
  // Hendrix's hot path picks LineageRows by (icpId, outcomeId, active=true). When that pool runs
  // thin, playback variety degrades; when it hits zero, Hendrix has nothing to play for that
  // (store-ICP × scheduled-outcome) combination. This dashboard surfaces that risk.

  app.get('/pool-depth', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return

    const [icps, activeOutcomes, counts] = await Promise.all([
      prisma.iCP.findMany({
        select: {
          id: true, name: true,
          store: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.outcome.findMany({
        where: { supersededAt: null },
        select: { id: true, title: true, version: true },
        orderBy: [{ title: 'asc' }, { version: 'desc' }],
      }),
      prisma.lineageRow.groupBy({
        by: ['icpId', 'outcomeId'],
        where: { active: true },
        _count: { _all: true },
      }),
    ])

    const countMap = new Map<string, number>()
    for (const c of counts) countMap.set(`${c.icpId}::${c.outcomeId}`, c._count._all)

    return {
      thresholds: { critical: 5, thin: 15 },
      icps: icps.map((icp) => ({
        id: icp.id,
        name: icp.name,
        stores: icp.store ? [icp.store] : [],
        outcomes: activeOutcomes.map((o) => {
          const count = countMap.get(`${icp.id}::${o.id}`) ?? 0
          return {
            outcome: o,
            count,
            status: count < 5 ? 'critical' : count < 15 ? 'thin' : 'ok',
          }
        }),
      })),
    }
  })

  // ----- Song Catalogue (LineageRow CRUD-lite + flagged review) -----
  // The LineageRow is the song-pool atom Hendrix reads. The catalogue group exposes
  // operator-facing browse / retire / restore / flagged-report views over it.

  app.get('/lineage-rows', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 200)
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0)
    const where: any = {}
    if (q.icpId) where.icpId = q.icpId
    if (q.outcomeId) where.outcomeId = q.outcomeId
    if (q.hookId) where.hookId = q.hookId
    if (q.active === 'true') where.active = true
    else if (q.active === 'false') where.active = false
    // active === 'all' or unset → no filter

    const [rows, total] = await Promise.all([
      prisma.lineageRow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          song: { select: { id: true, r2Url: true, byteSize: true } },
          hook: { select: { id: true, text: true } },
          outcome: { select: { id: true, title: true, version: true } },
        },
      }),
      prisma.lineageRow.count({ where }),
    ])

    // Resolve ICP names in one shot.
    const icpIds = [...new Set(rows.map((r) => r.icpId))]
    const icps = icpIds.length === 0 ? [] : await prisma.iCP.findMany({
      where: { id: { in: icpIds } },
      select: { id: true, name: true },
    })
    const icpById = new Map(icps.map((i) => [i.id, i.name]))

    return {
      total, limit, offset,
      rows: rows.map((r) => ({
        id: r.id,
        active: r.active,
        createdAt: r.createdAt.toISOString(),
        icpId: r.icpId,
        icpName: icpById.get(r.icpId) ?? null,
        outcome: r.outcome,
        hook: r.hook,
        song: r.song,
      })),
    }
  })

  const LineageRowPatch = z.object({ active: z.boolean() })

  app.patch('/lineage-rows/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = LineageRowPatch.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.lineageRow.update({
        where: { id },
        data: { active: parsed.data.active },
        include: {
          song: { select: { id: true, r2Url: true, byteSize: true } },
          hook: { select: { id: true, text: true } },
          outcome: { select: { id: true, title: true, version: true } },
        },
      })
      return { ...row, createdAt: row.createdAt.toISOString() }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // Flagged Review — every song that has at least one song_report event aggregated
  // by song, with counts per reason and the most recent report. The retire affordance
  // on this panel deactivates every LineageRow that references the offending song.
  app.get('/flagged', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return

    const events = await prisma.playbackEvent.findMany({
      where: { eventType: 'song_report', songId: { not: null } },
      select: { songId: true, reportReason: true, occurredAt: true, storeId: true },
      orderBy: { occurredAt: 'desc' },
    })
    if (events.length === 0) return { songs: [] }

    type Bucket = {
      songId: string
      reportCount: number
      lastReportedAt: Date
      reasons: Record<string, number>
      storeIds: Set<string>
    }
    const bySong = new Map<string, Bucket>()
    for (const e of events) {
      if (!e.songId) continue
      let b = bySong.get(e.songId)
      if (!b) {
        b = { songId: e.songId, reportCount: 0, lastReportedAt: e.occurredAt, reasons: {}, storeIds: new Set() }
        bySong.set(e.songId, b)
      }
      b.reportCount++
      if (e.reportReason) b.reasons[e.reportReason] = (b.reasons[e.reportReason] ?? 0) + 1
      if (e.occurredAt > b.lastReportedAt) b.lastReportedAt = e.occurredAt
      b.storeIds.add(e.storeId)
    }

    const songIds = [...bySong.keys()]
    const [lineageRows, songs] = await Promise.all([
      prisma.lineageRow.findMany({
        where: { songId: { in: songIds } },
        include: {
          hook: { select: { id: true, text: true } },
          outcome: { select: { id: true, title: true, version: true } },
        },
      }),
      prisma.song.findMany({
        where: { id: { in: songIds } },
        select: { id: true, r2Url: true },
      }),
    ])
    const songById = new Map(songs.map((s) => [s.id, s]))
    const lineageBySong = new Map<string, typeof lineageRows>()
    for (const lr of lineageRows) {
      const list = lineageBySong.get(lr.songId) ?? []
      list.push(lr)
      lineageBySong.set(lr.songId, list)
    }

    const out = [...bySong.values()].map((b) => {
      const lrs = lineageBySong.get(b.songId) ?? []
      const activeCount = lrs.filter((lr) => lr.active).length
      return {
        songId: b.songId,
        r2Url: songById.get(b.songId)?.r2Url ?? null,
        reportCount: b.reportCount,
        lastReportedAt: b.lastReportedAt.toISOString(),
        reasons: b.reasons,
        storeCount: b.storeIds.size,
        lineageRows: lrs.map((lr) => ({
          id: lr.id, active: lr.active, hook: lr.hook, outcome: lr.outcome,
        })),
        activeLineageCount: activeCount,
        anyActive: activeCount > 0,
      }
    }).sort((a, b) => {
      // Active-with-most-reports first; resolved (no active rows) sorted to bottom.
      if (a.anyActive !== b.anyActive) return a.anyActive ? -1 : 1
      return b.reportCount - a.reportCount
    })

    return { songs: out }
  })

  // Retire every LineageRow referencing a flagged song in one step. Append-only audio
  // events are untouched — this just deactivates pool membership.
  app.post('/flagged/:songId/retire', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const songId = (req.params as any).songId as string
    const result = await prisma.lineageRow.updateMany({
      where: { songId, active: true },
      data: { active: false },
    })
    return { retired: result.count }
  })

  // ----- Hooks (per-ICP queue) -----

  app.get('/icps/:id/hooks', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const rows = await prisma.hook.findMany({
      where: { icpId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { outcome: { select: { id: true, title: true, version: true } } },
    })
    return rows
  })

  const HookCreateBody = z.object({
    text: z.string().min(1),
    outcomeId: z.string().uuid(),
    approve: z.boolean().optional(),
  })

  // ----- Hook Drafter (per-ICP prompt + LLM run) -----

  app.get('/icps/:id/hook-writer-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const latest = await getOrSeedHookWriterPrompt(icpId)
    const history = await prisma.hookWriterPromptVersion.findMany({
      where: { icpId },
      orderBy: { version: 'desc' },
      take: 50,
    })
    return { latest, history }
  })

  const HookWriterPromptBody = z.object({ promptText: z.string().min(1), notes: z.string().nullable().optional() })

  app.put('/icps/:id/hook-writer-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const parsed = HookWriterPromptBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.hookWriterPrompt.findUnique({ where: { icpId } })
      const nextVersion = (existing?.version ?? 0) + 1
      const updated = await tx.hookWriterPrompt.upsert({
        where: { icpId },
        create: { icpId, promptText: parsed.data.promptText, version: nextVersion, updatedById: op.operatorId },
        update: { promptText: parsed.data.promptText, version: nextVersion, updatedById: op.operatorId },
      })
      await tx.hookWriterPromptVersion.create({
        data: {
          icpId, version: nextVersion,
          promptText: parsed.data.promptText,
          notes: parsed.data.notes ?? null,
          createdById: op.operatorId,
        },
      })
      return updated
    })
    return result
  })

  const DraftHooksBody = z.object({
    outcomeId: z.string().uuid(),
    n: z.number().int().min(1).max(20),
  })

  app.post('/icps/:id/hook-writer/run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const parsed = DraftHooksBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const result = await draftHooks({ icpId, outcomeId: parsed.data.outcomeId, n: parsed.data.n })
      return { hooks: result.hooks }
    } catch (e: any) {
      return reply.code(502).send({ error: 'drafter_failed', message: e.message ?? 'unknown' })
    }
  })

  // Bulk create hooks: same outcome, many text lines.
  const HookBulkBody = z.object({
    outcomeId: z.string().uuid(),
    texts: z.array(z.string().min(1)).min(1).max(100),
    approve: z.boolean().optional(),
  })

  app.post('/icps/:id/hooks/bulk', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const parsed = HookBulkBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const now = new Date()
      const data = parsed.data.texts.map((text) => ({
        icpId,
        outcomeId: parsed.data.outcomeId,
        text,
        status: parsed.data.approve ? 'approved' : 'draft',
        approvedAt: parsed.data.approve ? now : null,
        approvedById: parsed.data.approve ? op.operatorId : null,
      }))
      const result = await prisma.hook.createMany({ data, skipDuplicates: false })
      return { created: result.count }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        return reply.code(404).send({ error: 'icp_or_outcome_not_found' })
      }
      throw e
    }
  })

  app.post('/icps/:id/hooks', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const parsed = HookCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const data: any = {
        icpId,
        outcomeId: parsed.data.outcomeId,
        text: parsed.data.text,
        status: parsed.data.approve ? 'approved' : 'draft',
      }
      if (parsed.data.approve) {
        data.approvedAt = new Date()
        data.approvedById = op.operatorId
      }
      const row = await prisma.hook.create({ data, include: { outcome: { select: { id: true, title: true, version: true } } } })
      return row
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        return reply.code(404).send({ error: 'icp_or_outcome_not_found' })
      }
      throw e
    }
  })

  const HookUpdateBody = z.object({
    text: z.string().min(1).optional(),
    outcomeId: z.string().uuid().optional(),
  })

  app.put('/hooks/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = HookUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const existing = await prisma.hook.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'approved') {
      return reply.code(409).send({ error: 'approved_hook_immutable', message: 'Approved hooks cannot be edited. Create a new hook instead.' })
    }
    const row = await prisma.hook.update({
      where: { id }, data: parsed.data,
      include: { outcome: { select: { id: true, title: true, version: true } } },
    })
    return row
  })

  app.post('/hooks/:id/approve', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.hook.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'approved') return existing
    if (existing.status === 'retired') return reply.code(409).send({ error: 'retired_hook_cannot_be_approved' })
    const row = await prisma.hook.update({
      where: { id },
      data: { status: 'approved', approvedAt: new Date(), approvedById: op.operatorId },
      include: { outcome: { select: { id: true, title: true, version: true } } },
    })
    return row
  })

  // Hook retirement — preview returns the in-flight Submission count so the operator
  // sees what will be left dangling. POST /retire applies it (skip in-flight check
  // with ?force=true if the operator has decided that's fine).
  app.get('/hooks/:id/retire-preview', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const hook = await prisma.hook.findUnique({ where: { id } })
    if (!hook) return reply.code(404).send({ error: 'not_found' })
    const inFlight = await prisma.songSeed.count({
      where: { hookId: id, status: { in: ['assembling', 'queued'] } },
    })
    const lineageActive = await prisma.lineageRow.count({ where: { hookId: id, active: true } })
    return {
      hookId: id, status: hook.status,
      inFlightSongSeeds: inFlight,
      activeLineageRows: lineageActive,
      warning: inFlight > 0
        ? `${inFlight} in-flight song seed${inFlight === 1 ? '' : 's'} still reference this hook. Retiring will leave them dangling — they can still be accepted but no new ones will pick this hook.`
        : null,
    }
  })

  const RetireBody = z.object({ force: z.boolean().optional() })

  app.post('/hooks/:id/retire', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = RetireBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const hook = await prisma.hook.findUnique({ where: { id } })
    if (!hook) return reply.code(404).send({ error: 'not_found' })
    if (hook.status === 'retired') return hook
    const inFlight = await prisma.songSeed.count({
      where: { hookId: id, status: { in: ['assembling', 'queued'] } },
    })
    if (inFlight > 0 && !parsed.data.force) {
      return reply.code(409).send({
        error: 'in_flight_song_seeds',
        inFlightSongSeeds: inFlight,
        message: `${inFlight} in-flight song seed(s) reference this hook. Pass force=true to retire anyway.`,
      })
    }
    const row = await prisma.hook.update({
      where: { id }, data: { status: 'retired' },
      include: { outcome: { select: { id: true, title: true, version: true } } },
    })
    return row
  })

  // ----- Playback: live store view + override -----

  app.get('/stores/:id/live', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const store = await prisma.store.findUnique({
      where: { id },
      include: { client: { select: { companyName: true } }, icps: { select: { id: true } } },
    })
    if (!store) return reply.code(404).send({ error: 'not_found' })
    const icpIds = store.icps.map((i) => i.id)

    const [hendrix, outcomes, lineageCounts, events] = await Promise.all([
      nextQueue(id),
      prisma.outcome.findMany({ where: { supersededAt: null }, orderBy: { title: 'asc' } }),
      icpIds.length === 0 ? Promise.resolve([]) : prisma.lineageRow.groupBy({
        by: ['outcomeId'],
        where: { icpId: { in: icpIds }, active: true },
        _count: { _all: true },
      }),
      prisma.playbackEvent.findMany({
        where: { storeId: id },
        orderBy: { occurredAt: 'desc' },
        take: 30,
        include: {
          operator: { select: { id: true, email: true } },
        },
      }),
    ])

    const poolByOutcome = new Map(lineageCounts.map((c) => [c.outcomeId, c._count._all]))
    const outcomeById = new Map(outcomes.map((o) => [o.id, o]))

    const queueHookIds = [...new Set(hendrix.queue.map((q) => q.hookId))]
    const queueHooks = queueHookIds.length
      ? await prisma.hook.findMany({ where: { id: { in: queueHookIds } }, select: { id: true, text: true } })
      : []
    const hookTextById = new Map(queueHooks.map((h) => [h.id, h.text]))
    const queueWithTitles = hendrix.queue.map((q) => ({
      ...q,
      hookText: hookTextById.get(q.hookId) ?? null,
      outcomeTitle: outcomeById.get(q.outcomeId)?.title ?? null,
    }))

    const activeOutcomeRow = hendrix.activeOutcome ? outcomeById.get(hendrix.activeOutcome.outcomeId) : null

    return {
      store: {
        id: store.id,
        name: store.name,
        clientName: store.client.companyName,
        timezone: store.timezone,
        icpIds: icpIds,
        defaultOutcomeId: store.defaultOutcomeId,
        outcomeSelectionId: store.outcomeSelectionId,
        outcomeSelectionExpiresAt: store.outcomeSelectionExpiresAt,
      },
      active: hendrix.activeOutcome ? {
        outcomeId: hendrix.activeOutcome.outcomeId,
        outcomeTitle: activeOutcomeRow?.title ?? null,
        source: hendrix.activeOutcome.source,
        expiresAt: hendrix.activeOutcome.expiresAt ?? null,
      } : null,
      queue: queueWithTitles,
      fallbackTier: hendrix.fallbackTier,
      reason: hendrix.reason,
      outcomes: outcomes.map((o) => ({
        outcomeId: o.id,
        title: o.title,
        version: o.version,
        tempoBpm: o.tempoBpm,
        mode: o.mode,
        poolSize: poolByOutcome.get(o.id) ?? 0,
      })),
      recentEvents: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        songId: e.songId,
        hookId: e.hookId,
        outcomeId: e.outcomeId,
        outcomeTitle: e.outcomeId ? (outcomeById.get(e.outcomeId)?.title ?? null) : null,
        operatorId: e.operatorId,
        operatorEmail: e.operator?.email ?? null,
        reportReason: e.reportReason,
      })),
    }
  })

  const OverrideBody = z.object({ outcomeId: z.string().uuid() })

  app.post('/stores/:id/outcome-selection', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = OverrideBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const { outcomeId, expiresAt } = await setOverride(id, parsed.data.outcomeId)
      await prisma.playbackEvent.create({
        data: {
          eventType: 'outcome_selection',
          storeId: id,
          occurredAt: new Date(),
          operatorId: op.operatorId,
          outcomeId,
        },
      })
      return { outcomeId, expiresAt: expiresAt.toISOString() }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message ?? 'failed' })
    }
  })

  app.post('/stores/:id/outcome-selection/clear', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await clearOverride(id)
      await prisma.playbackEvent.create({
        data: {
          eventType: 'outcome_selection_cleared',
          storeId: id,
          occurredAt: new Date(),
          operatorId: op.operatorId,
        },
      })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message ?? 'failed' })
    }
  })

  // ----- Schedule (per-store weekly grid) -----

  app.get('/stores/:id/schedule', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const rows = await prisma.scheduleSlot.findMany({
      where: { storeId: id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: { outcome: { select: { id: true, title: true, version: true } } },
    })
    return rows.map((r) => ({
      id: r.id,
      storeId: r.storeId,
      dayOfWeek: r.dayOfWeek,
      startTime: timeToHHMM(r.startTime),
      endTime: timeToHHMM(r.endTime),
      outcomeId: r.outcomeId,
      outcomeTitle: r.outcome.title,
      outcomeVersion: r.outcome.version,
    }))
  })

  const ScheduleBody = z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    outcomeId: z.string().uuid(),
  })

  app.post('/stores/:id/schedule', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = ScheduleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    const newStart = hhmmToSec(parsed.data.startTime)
    const newEnd = hhmmToSec(parsed.data.endTime)
    const existing = await prisma.scheduleSlot.findMany({ where: { storeId: id, dayOfWeek: parsed.data.dayOfWeek } })
    const clash = existing.find((s) => newStart < hhmmToSec(timeToHHMM(s.endTime)) && hhmmToSec(timeToHHMM(s.startTime)) < newEnd)
    if (clash) {
      return reply.code(409).send({ error: 'schedule_overlap', message: `Overlaps with existing slot ${timeToHHMM(clash.startTime)}–${timeToHHMM(clash.endTime)}` })
    }
    try {
      const row = await prisma.scheduleSlot.create({
        data: {
          storeId: id,
          dayOfWeek: parsed.data.dayOfWeek,
          startTime: hhmmToTime(parsed.data.startTime),
          endTime: hhmmToTime(parsed.data.endTime),
          outcomeId: parsed.data.outcomeId,
        },
        include: { outcome: { select: { title: true, version: true } } },
      })
      return {
        id: row.id, storeId: row.storeId, dayOfWeek: row.dayOfWeek,
        startTime: timeToHHMM(row.startTime), endTime: timeToHHMM(row.endTime),
        outcomeId: row.outcomeId, outcomeTitle: row.outcome.title, outcomeVersion: row.outcome.version,
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        return reply.code(404).send({ error: 'store_or_outcome_not_found' })
      }
      throw e
    }
  })

  app.put('/schedule-rows/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = ScheduleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    const current = await prisma.scheduleSlot.findUnique({ where: { id } })
    if (!current) return reply.code(404).send({ error: 'not_found' })
    const updStart = hhmmToSec(parsed.data.startTime)
    const updEnd = hhmmToSec(parsed.data.endTime)
    const siblings = await prisma.scheduleSlot.findMany({
      where: { storeId: current.storeId, dayOfWeek: parsed.data.dayOfWeek, id: { not: id } },
    })
    const clash = siblings.find((s) => updStart < hhmmToSec(timeToHHMM(s.endTime)) && hhmmToSec(timeToHHMM(s.startTime)) < updEnd)
    if (clash) {
      return reply.code(409).send({ error: 'schedule_overlap', message: `Overlaps with existing slot ${timeToHHMM(clash.startTime)}–${timeToHHMM(clash.endTime)}` })
    }
    try {
      const row = await prisma.scheduleSlot.update({
        where: { id },
        data: {
          dayOfWeek: parsed.data.dayOfWeek,
          startTime: hhmmToTime(parsed.data.startTime),
          endTime: hhmmToTime(parsed.data.endTime),
          outcomeId: parsed.data.outcomeId,
        },
        include: { outcome: { select: { title: true, version: true } } },
      })
      return {
        id: row.id, storeId: row.storeId, dayOfWeek: row.dayOfWeek,
        startTime: timeToHHMM(row.startTime), endTime: timeToHHMM(row.endTime),
        outcomeId: row.outcomeId, outcomeTitle: row.outcome.title, outcomeVersion: row.outcome.version,
      }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete('/schedule-rows/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await prisma.scheduleSlot.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ----- Schedule Dry Run (project 7-day resolution; surface gaps + thin pools) -----
  // Walks the weekly schedule store-locally Mon..Sun, fills gaps with the store default
  // outcome (or marks them as 'gap' if no default is set), then joins per-(icp × outcome)
  // active LineageRow counts so operators can see which pools their schedule actually
  // depends on. Pure projection — does not touch override or current time.

  app.get('/stores/:id/schedule-dry-run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).id as string

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: {
        icps: { select: { id: true, name: true } },
        defaultOutcome: { select: { id: true, title: true, version: true, supersededAt: true } },
      },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const dryRunIcpIds = store.icps.map((i) => i.id)

    const rows = await prisma.scheduleSlot.findMany({
      where: { storeId },
      include: { outcome: { select: { id: true, title: true, version: true, supersededAt: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    })

    const DAY_SEC = 86400
    const dayLabels = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const fmtHHMM = (sec: number) => {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    const def = store.defaultOutcome ?? null
    const usedOutcomes = new Map<string, { id: string; title: string; version: number; superseded: boolean }>()
    if (def) usedOutcomes.set(def.id, { id: def.id, title: def.title, version: def.version, superseded: !!def.supersededAt })

    type Period = {
      startSec: number; endSec: number
      startHHMM: string; endHHMM: string
      source: 'schedule' | 'default' | 'gap'
      outcomeId: string | null
      outcomeTitle: string | null
      outcomeVersion: number | null
      outcomeSuperseded: boolean
      durationMin: number
      overlap: boolean
    }

    const days = [1, 2, 3, 4, 5, 6, 7].map((dow) => {
      const dayRows = rows
        .filter((r) => r.dayOfWeek === dow)
        .map((r) => ({
          startSec: r.startTime.getUTCHours() * 3600 + r.startTime.getUTCMinutes() * 60,
          endSec: r.endTime.getUTCHours() * 3600 + r.endTime.getUTCMinutes() * 60,
          outcome: r.outcome,
        }))
        .sort((a, b) => a.startSec - b.startSec)

      const periods: Period[] = []
      let cursor = 0
      let prevEnd = 0

      const pushGap = (from: number, to: number) => {
        if (to <= from) return
        if (def) {
          periods.push({
            startSec: from, endSec: to,
            startHHMM: fmtHHMM(from), endHHMM: fmtHHMM(to),
            source: 'default',
            outcomeId: def.id, outcomeTitle: def.title, outcomeVersion: def.version,
            outcomeSuperseded: !!def.supersededAt,
            durationMin: Math.round((to - from) / 60),
            overlap: false,
          })
        } else {
          periods.push({
            startSec: from, endSec: to,
            startHHMM: fmtHHMM(from), endHHMM: fmtHHMM(to),
            source: 'gap',
            outcomeId: null, outcomeTitle: null, outcomeVersion: null,
            outcomeSuperseded: false,
            durationMin: Math.round((to - from) / 60),
            overlap: false,
          })
        }
      }

      for (const r of dayRows) {
        const overlap = r.startSec < prevEnd
        if (r.startSec > cursor) pushGap(cursor, r.startSec)
        const start = Math.max(cursor, r.startSec)
        const end = Math.max(start, r.endSec)
        usedOutcomes.set(r.outcome.id, {
          id: r.outcome.id, title: r.outcome.title, version: r.outcome.version,
          superseded: !!r.outcome.supersededAt,
        })
        periods.push({
          startSec: start, endSec: end,
          startHHMM: fmtHHMM(start), endHHMM: fmtHHMM(end),
          source: 'schedule',
          outcomeId: r.outcome.id, outcomeTitle: r.outcome.title, outcomeVersion: r.outcome.version,
          outcomeSuperseded: !!r.outcome.supersededAt,
          durationMin: Math.round((end - start) / 60),
          overlap,
        })
        cursor = Math.max(cursor, end)
        prevEnd = Math.max(prevEnd, r.endSec)
      }
      if (cursor < DAY_SEC) pushGap(cursor, DAY_SEC)

      return { dayOfWeek: dow, label: dayLabels[dow], periods }
    })

    // Pool depth join — only for outcomes actually used by this store's projection.
    const outcomeIds = Array.from(usedOutcomes.keys())
    const counts = outcomeIds.length === 0 || dryRunIcpIds.length === 0 ? [] : await prisma.lineageRow.groupBy({
      by: ['outcomeId'],
      where: { active: true, icpId: { in: dryRunIcpIds }, outcomeId: { in: outcomeIds } },
      _count: { _all: true },
    })
    const countMap = new Map<string, number>()
    for (const c of counts) countMap.set(c.outcomeId, c._count._all)
    const thresholds = { critical: 5, thin: 15 }
    const statusOf = (n: number) => (n < thresholds.critical ? 'critical' : n < thresholds.thin ? 'thin' : 'ok')

    // Per-outcome totals.
    const totalsByOutcome = new Map<string, { scheduledMin: number; defaultMin: number }>()
    for (const day of days) {
      for (const p of day.periods) {
        if (!p.outcomeId) continue
        const cur = totalsByOutcome.get(p.outcomeId) ?? { scheduledMin: 0, defaultMin: 0 }
        if (p.source === 'schedule') cur.scheduledMin += p.durationMin
        else if (p.source === 'default') cur.defaultMin += p.durationMin
        totalsByOutcome.set(p.outcomeId, cur)
      }
    }

    const byOutcome = Array.from(usedOutcomes.values()).map((o) => {
      const t = totalsByOutcome.get(o.id) ?? { scheduledMin: 0, defaultMin: 0 }
      const count = countMap.get(o.id) ?? 0
      return {
        outcomeId: o.id, outcomeTitle: o.title, outcomeVersion: o.version,
        outcomeSuperseded: o.superseded,
        scheduledMin: t.scheduledMin, defaultMin: t.defaultMin,
        totalMin: t.scheduledMin + t.defaultMin,
        poolCount: count, poolStatus: statusOf(count),
      }
    }).sort((a, b) => b.totalMin - a.totalMin)

    let scheduledMin = 0, defaultMin = 0, gapMin = 0
    for (const day of days) {
      for (const p of day.periods) {
        if (p.source === 'schedule') scheduledMin += p.durationMin
        else if (p.source === 'default') defaultMin += p.durationMin
        else gapMin += p.durationMin
      }
    }

    return {
      store: { id: store.id, name: store.name, timezone: store.timezone },
      icps: store.icps.map((i) => ({ id: i.id, name: i.name })),
      defaultOutcome: def ? { id: def.id, title: def.title, version: def.version, superseded: !!def.supersededAt } : null,
      thresholds,
      days,
      byOutcome,
      totals: { scheduledMin, defaultMin, gapMin, totalMin: scheduledMin + defaultMin + gapMin },
    }
  })

  app.delete('/hooks/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.hook.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'approved') {
      return reply.code(409).send({ error: 'approved_hook_immutable', message: 'Approved hooks cannot be deleted. Retirement flow not implemented yet.' })
    }
    await prisma.hook.delete({ where: { id } })
    return { ok: true }
  })

  // ----- Operator Seeding (Card 16): Submissions + EnoRuns -----

  const SongSeedsListQuery = z.object({
    icpId: z.string().uuid().optional(),
    status: z.string().optional(),
    claimedBy: z.string().optional(), // 'me' | 'unclaimed' | uuid
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })

  app.get('/song-seeds', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = SongSeedsListQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_query', details: parsed.error.flatten() })
    const where: any = {}
    if (parsed.data.icpId) where.icpId = parsed.data.icpId
    if (parsed.data.status) where.status = parsed.data.status
    if (parsed.data.claimedBy === 'unclaimed') where.claimedById = null
    else if (parsed.data.claimedBy === 'me') where.claimedById = op.operatorId
    else if (parsed.data.claimedBy) where.claimedById = parsed.data.claimedBy
    const rows = await prisma.songSeed.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: parsed.data.limit ?? 100,
      include: {
        hook: { select: { id: true, text: true } },
        outcome: { select: { id: true, title: true, version: true } },
        referenceTrack: { select: { id: true, artist: true, title: true } },
        songSeedBatch: { select: { id: true, startedAt: true, triggeredBy: true } },
      },
    })
    return rows
  })

  app.get('/song-seeds/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const row = await prisma.songSeed.findUnique({
      where: { id },
      include: {
        hook: { select: { id: true, text: true } },
        outcome: true,
        referenceTrack: { include: { styleAnalysis: true } },
        songSeedBatch: true,
        lineageRows: { include: { song: true } },
      },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  const SeedBuilderRunBody = z.object({
    icpId: z.string().uuid(),
    outcomeId: z.string().uuid(),
    n: z.number().int().min(1).max(20),
  })

  app.post('/eno/run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = SeedBuilderRunBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const result = await runEno({
        icpId: parsed.data.icpId,
        outcomeId: parsed.data.outcomeId,
        n: parsed.data.n,
        triggeredBy: 'manual',
        triggeredByUser: op.operatorId,
      })
      return result
    } catch (e: any) {
      return reply.code(502).send({ error: 'eno_failed', message: e.message ?? 'unknown' })
    }
  })

  app.post('/song-seeds/:id/claim', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.songSeed.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued', message: `SongSeed is ${existing.status}` })
    if (existing.claimedById && existing.claimedById !== op.operatorId) {
      return reply.code(409).send({ error: 'already_claimed' })
    }
    const row = await prisma.songSeed.update({
      where: { id }, data: { claimedById: op.operatorId, claimedAt: new Date() },
    })
    return row
  })

  app.post('/song-seeds/:id/release', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.songSeed.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued' })
    const row = await prisma.songSeed.update({
      where: { id }, data: { claimedById: null, claimedAt: null },
    })
    return row
  })

  app.post('/song-seeds/:id/skip', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.songSeed.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued' })
    const row = await prisma.songSeed.update({
      where: { id }, data: { status: 'skipped', terminalAt: new Date() },
    })
    return row
  })

  app.post('/song-seeds/:id/abandon', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.songSeed.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued' })
    const row = await prisma.songSeed.update({
      where: { id }, data: { status: 'abandoned', terminalAt: new Date() },
    })
    return row
  })

  // Accept: body { takes: [{ sourceUrl }] }
  // For each take: download from sourceUrl (Suno CDN, etc.), upload to R2 under
  // submissions/{id}/take-{i}.mp3, upsert Song (r2Url unique), create LineageRow.
  // Then status=accepted, terminal_at=now, increment reference_track.use_count.
  const AcceptBody = z.object({
    takes: z.array(z.object({
      sourceUrl: z.string().url(),
    })).min(1).max(2),
  })

  app.post('/song-seeds/:id/accept', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = AcceptBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })

    const existing = await prisma.songSeed.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued', message: `SongSeed is ${existing.status}` })

    // Step 1: download + reupload each take to R2 BEFORE opening the transaction.
    // R2 puts are external I/O — keeping them out of the DB transaction avoids
    // long-held DB connections.
    const uploaded: { url: string; key: string; byteSize: number; contentType: string }[] = []
    try {
      for (let i = 0; i < parsed.data.takes.length; i++) {
        const take = parsed.data.takes[i]!
        const key = `song-seeds/${id}/take-${i + 1}-${Date.now()}.mp3`
        const obj = await downloadAndUploadFromUrl(take.sourceUrl, key)
        uploaded.push(obj)
      }
    } catch (e: any) {
      return reply.code(502).send({ error: 'r2_upload_failed', message: e.message ?? 'unknown' })
    }

    // Step 2: persist (Songs + LineageRows + Submission flip + useCount bumps) in one transaction.
    const outcome = await prisma.outcome.findUnique({ where: { id: existing.outcomeId }, select: { version: true } })
    try {
      const result = await prisma.$transaction(async (tx) => {
        const lineage: any[] = []
        for (const obj of uploaded) {
          const song = await tx.song.upsert({
            where: { r2Url: obj.url },
            create: {
              r2Url: obj.url,
              r2ObjectKey: obj.key,
              byteSize: BigInt(obj.byteSize),
              contentType: obj.contentType,
            },
            update: {},
          })
          const row = await tx.lineageRow.create({
            data: {
              songId: song.id,
              r2Url: obj.url,
              icpId: existing.icpId,
              outcomeId: existing.outcomeId,
              outcomeVersion: outcome?.version ?? null,
              hookId: existing.hookId,
              songSeedId: existing.id,
              active: true,
            },
          })
          lineage.push(row)
        }
        // Status flip — partial unique on (hook_id) WHERE status='accepted' enforces 1-per-hook.
        const updated = await tx.songSeed.update({
          where: { id }, data: { status: 'accepted', terminalAt: new Date() },
        })
        if (existing.referenceTrackId) {
          await tx.referenceTrack.update({
            where: { id: existing.referenceTrackId },
            data: { useCount: { increment: 1 } },
          })
        }
        await tx.hook.update({
          where: { id: existing.hookId },
          data: { useCount: { increment: 1 } },
        })
        return { songSeed: updated, lineageRows: lineage }
      })
      return result
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.code(409).send({ error: 'hook_already_accepted', message: 'Another song seed for this hook has already been accepted.' })
      }
      return reply.code(500).send({ error: 'accept_failed', message: e.message ?? 'unknown' })
    }
  })

  app.put('/decompositions/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = DecompositionUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const existing = await prisma.styleAnalysis.findUnique({ where: { id }, select: { verifiedAt: true, status: true } })
    const wasVerified = !!existing?.verifiedAt && existing.status === 'verified'
    const data: any = { ...parsed.data }
    if (parsed.data.status === 'verified') {
      data.verifiedAt = new Date()
      data.verifiedById = op.operatorId
    } else if (parsed.data.status === 'draft') {
      data.verifiedAt = null
      data.verifiedById = null
    }
    try {
      const row = await prisma.styleAnalysis.update({ where: { id }, data })
      const warning = wasVerified && row.status !== 'verified'
        ? 'Edited a previously verified decomposition. Re-verify when ready.'
        : undefined
      return { ...row, _warning: warning }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ── Operator management ──────────────────────────────────────────────────

  // GET /admin/operators — list all operators with store assignments
  app.get('/operators', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.operator.findMany({
      orderBy: { email: 'asc' },
      include: { storeAssignments: { include: { store: { select: { id: true, name: true, client: { select: { companyName: true } } } } } } },
    })
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      isAdmin: r.isAdmin,
      disabledAt: r.disabledAt?.toISOString() ?? null,
      stores: r.storeAssignments.map((a) => ({ id: a.store.id, name: a.store.name, clientName: a.store.client?.companyName ?? null })),
    }))
  })

  const OperatorCreateBody = z.object({
    email: z.string().email().transform((s) => s.trim().toLowerCase()),
    password: z.string().min(1),
    displayName: z.string().nullable().optional(),
    storeIds: z.array(z.string().uuid()).optional(),
  })

  // POST /admin/operators — create a new operator
  app.post('/operators', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = OperatorCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const passwordHash = await bcrypt.hash(parsed.data.password, 10)
    try {
      const created = await prisma.operator.create({
        data: {
          email: parsed.data.email,
          passwordHash,
          displayName: parsed.data.displayName ?? null,
          isAdmin: false,
          storeAssignments: parsed.data.storeIds?.length
            ? { create: parsed.data.storeIds.map((storeId) => ({ storeId, assignedById: op.operatorId })) }
            : undefined,
        },
        include: { storeAssignments: { include: { store: { select: { id: true, name: true, client: { select: { companyName: true } } } } } } },
      })
      return {
        id: created.id, email: created.email, displayName: created.displayName,
        isAdmin: created.isAdmin, disabledAt: null,
        stores: created.storeAssignments.map((a) => ({ id: a.store.id, name: a.store.name, clientName: a.store.client?.companyName ?? null })),
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.code(409).send({ error: 'email_taken' })
      }
      throw e
    }
  })

  const OperatorUpdateBody = z.object({
    email: z.string().email().transform((s) => s.trim().toLowerCase()).optional(),
    password: z.string().min(1).optional(),
    displayName: z.string().nullable().optional(),
    storeIds: z.array(z.string().uuid()).optional(),
    disabled: z.boolean().optional(),
  })

  // PUT /admin/operators/:id — update email, password, stores, or disabled state
  app.put('/operators/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = OperatorUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const data: any = {}
    if (parsed.data.email !== undefined) data.email = parsed.data.email
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName
    if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 10)
    if (parsed.data.disabled !== undefined) data.disabledAt = parsed.data.disabled ? new Date() : null
    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (parsed.data.storeIds !== undefined) {
          await tx.operatorStoreAssignment.deleteMany({ where: { operatorId: id } })
          if (parsed.data.storeIds.length > 0) {
            await tx.operatorStoreAssignment.createMany({
              data: parsed.data.storeIds.map((storeId) => ({ operatorId: id, storeId, assignedById: op.operatorId })),
            })
          }
        }
        return tx.operator.update({
          where: { id },
          data,
          include: { storeAssignments: { include: { store: { select: { id: true, name: true, client: { select: { companyName: true } } } } } } },
        })
      })
      return {
        id: updated.id, email: updated.email, displayName: updated.displayName,
        isAdmin: updated.isAdmin, disabledAt: updated.disabledAt?.toISOString() ?? null,
        stores: updated.storeAssignments.map((a) => ({ id: a.store.id, name: a.store.name, clientName: a.store.client?.companyName ?? null })),
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return reply.code(409).send({ error: 'email_taken' })
        if (e.code === 'P2025') return reply.code(404).send({ error: 'not_found' })
      }
      throw e
    }
  })
}
