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
import { downloadAndUploadFromUrl, uploadBuffer } from '../lib/r2.js'
import { draftHooks, getOrSeedHookWriterPrompt, buildHookDrafterContext } from '../lib/hooks/drafter.js'
import { suggestReferenceTracks } from '../lib/ref-tracks/suggester.js'
import { resolvePreview } from '../lib/ref-tracks/preview.js'
import { parseRetailNextXls } from '../lib/retailnext/parser.js'

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

  const SuggestRefTracksBody = z.object({
    buckets: z.array(z.enum(['PreFormation', 'FormationEra', 'Subculture', 'Aspirational', 'Adjacent'])).optional(),
  })
  app.post('/icps/:id/suggest-reference-tracks', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const exists = await prisma.iCP.findUnique({ where: { id: icpId }, select: { id: true } })
    if (!exists) return reply.code(404).send({ error: 'icp_not_found' })
    const parsed = SuggestRefTracksBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const result = await suggestReferenceTracks({ icpId, buckets: parsed.data.buckets })
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
            defaultOutcome: { select: { id: true, title: true, displayTitle: true, version: true } },
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
    bucket: z.enum(['PreFormation', 'FormationEra', 'Subculture', 'Aspirational', 'Adjacent']),
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

  // --- Resolve a 30s preview URL (Spotify → iTunes fallback) and cache on the row. ---
  // Returns the existing cached value if previously resolved.
  // ?force=1 retries even if a prior attempt set source='none'.
  app.post('/reference-tracks/:id/preview', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const force = (req.query as any)?.force === '1'
    const ref = await prisma.referenceTrack.findUnique({ where: { id } })
    if (!ref) return reply.code(404).send({ error: 'not_found' })
    // Deezer signs preview URLs with an `hdnea=exp=<unix>` token (~24h
    // TTL); iTunes URLs don't expire. If the cached URL has an `exp=` in
    // the past (or within the next 60s), re-resolve so the player doesn't
    // hit a 403.
    const isStale = (url: string | null): boolean => {
      if (!url) return false
      const m = url.match(/[?&~=]exp=(\d+)/)
      if (!m) return false
      const expSec = Number(m[1])
      return !Number.isFinite(expSec) || expSec * 1000 <= Date.now() + 60_000
    }
    if (!force && ref.previewSource && !isStale(ref.previewUrl)) {
      return {
        previewUrl: ref.previewUrl,
        previewSource: ref.previewSource,
        coverUrl: ref.coverUrl,
      }
    }
    const r = await resolvePreview(ref.artist, ref.title)
    const updated = await prisma.referenceTrack.update({
      where: { id },
      data: { previewUrl: r.previewUrl, previewSource: r.source, coverUrl: r.coverUrl },
    })
    return {
      previewUrl: updated.previewUrl,
      previewSource: updated.previewSource,
      coverUrl: updated.coverUrl,
    }
  })

  // --- Reject a pending suggestion. Soft-delete: keeps the row so the
  // suggester learns to exclude it from future runs. Idempotent. ---
  app.post('/reference-tracks/:id/reject', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      const row = await prisma.referenceTrack.update({
        where: { id },
        data: { status: 'rejected' },
      })
      return row
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

  // --- Bulk-approve every pending reference track on an ICP. Optional `bucket`
  // query param scopes the approval to one bucket; omit to approve all pending
  // across all buckets on this ICP. ---
  app.post('/icps/:id/reference-tracks/approve-all-pending', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const bucket = (req.query as any)?.bucket as string | undefined
    const allowedBuckets = ['PreFormation', 'FormationEra', 'Subculture', 'Aspirational', 'Adjacent'] as const
    if (bucket && !allowedBuckets.includes(bucket as any)) {
      return reply.code(400).send({ error: 'bad_bucket', message: `bucket must be one of ${allowedBuckets.join(', ')}` })
    }
    const exists = await prisma.iCP.findUnique({ where: { id: icpId }, select: { id: true } })
    if (!exists) return reply.code(404).send({ error: 'icp_not_found' })
    const where: Prisma.ReferenceTrackWhereInput = {
      icpId,
      status: 'pending',
      ...(bucket ? { bucket: bucket as (typeof allowedBuckets)[number] } : {}),
    }
    const targets = await prisma.referenceTrack.findMany({ where, select: { id: true } })
    if (targets.length === 0) return { approvedCount: 0, ids: [] as string[] }
    const ids = targets.map((t) => t.id)
    await prisma.referenceTrack.updateMany({
      where: { id: { in: ids } },
      data: { status: 'approved', approvedAt: new Date(), approvedById: op.operatorId },
    })
    return { approvedCount: ids.length, ids }
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
      // v8+ drops these two fields. Older rules versions still populate them.
      arrangementShape: result.output.arrangement_shape ?? null,
      dynamicCurve: result.output.dynamic_curve ?? null,
      vocalCharacter: result.output.vocal_character,
      vocalArrangement: result.output.vocal_arrangement,
      harmonicAndGroove: result.output.harmonic_and_groove,
      arrangementSections: result.output.arrangement_sections ?? Prisma.JsonNull,
      arrangementVersion: result.output.arrangement_sections ? result.rulesVersion : null,
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

  // ----- Bulk: decompose every approved reference track across all ICPs -----

  app.post('/reference-tracks/decompose-all', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const tracks = await prisma.referenceTrack.findMany({
      where: { status: 'approved' },
      include: { styleAnalysis: true },
    })
    let processed = 0
    let failed = 0
    const errors: { id: string; artist: string; title: string; error: string }[] = []
    for (const ref of tracks) {
      try {
        const result = await decompose({
          artist: ref.artist,
          title: ref.title,
          year: ref.year ?? undefined,
          operatorNotes: ref.operatorNotes ?? undefined,
        })
        const data = {
          styleAnalyzerInstructionsVersion: result.rulesVersion,
          status: 'draft' as const,
          verifiedAt: null,
          verifiedById: null,
          confidence: result.output.confidence,
          vibePitch: result.output.vibe_pitch,
          eraProductionSignature: result.output.era_production_signature,
          instrumentationPalette: result.output.instrumentation_palette,
          standoutElement: result.output.standout_element,
          arrangementShape: result.output.arrangement_shape ?? null,
          dynamicCurve: result.output.dynamic_curve ?? null,
          vocalCharacter: result.output.vocal_character,
          vocalArrangement: result.output.vocal_arrangement,
          harmonicAndGroove: result.output.harmonic_and_groove,
          arrangementSections: result.output.arrangement_sections ?? Prisma.JsonNull,
          arrangementVersion: result.output.arrangement_sections ? result.rulesVersion : null,
        }
        await prisma.styleAnalysis.upsert({
          where: { referenceTrackId: ref.id },
          create: { referenceTrackId: ref.id, ...data },
          update: data,
        })
        processed++
      } catch (e: any) {
        failed++
        errors.push({ id: ref.id, artist: ref.artist, title: ref.title, error: e.message ?? 'unknown' })
      }
    }
    return { total: tracks.length, processed, failed, errors }
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
    displayTitle: z.string().nullable().optional(),
    tempoBpm: z.number().int().min(40).max(220),
    mode: z.string().min(1),
    mood: z.string().min(1),
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
        displayTitle: parsed.data.displayTitle ?? null,
        tempoBpm: parsed.data.tempoBpm,
        mode: parsed.data.mode,
        mood: parsed.data.mood,
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
            displayTitle: parsed.data.displayTitle ?? null,
            tempoBpm: parsed.data.tempoBpm,
            mode: parsed.data.mode,
            mood: parsed.data.mood,
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

  // ----- OutcomeLyricFactor (per-outcome guidance for Hook Drafter) -----
  // Keyed by outcomeKey (the family) so iterating guidance doesn't spawn new
  // Outcome versions and break version-pinned downstream rows.

  app.get('/outcome-lyric-factors', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    // Return one row per active Outcome family with its current lyric factor
    // (or null if never set), so the editor can render every outcome.
    const [outcomes, factors] = await Promise.all([
      prisma.outcome.findMany({
        where: { supersededAt: null },
        orderBy: [{ title: 'asc' }],
        select: { id: true, outcomeKey: true, title: true, displayTitle: true, version: true },
      }),
      prisma.outcomeLyricFactor.findMany(),
    ])
    const factorByKey = new Map(factors.map((f) => [f.outcomeKey, f]))
    return outcomes.map((o) => ({
      outcomeId: o.id,
      outcomeKey: o.outcomeKey,
      title: o.title,
      displayTitle: o.displayTitle,
      version: o.version,
      templateText: factorByKey.get(o.outcomeKey)?.templateText ?? '',
      notes: factorByKey.get(o.outcomeKey)?.notes ?? null,
      updatedAt: factorByKey.get(o.outcomeKey)?.updatedAt?.toISOString() ?? null,
    }))
  })

  const OutcomeLyricFactorBody = z.object({
    templateText: z.string(),
    notes: z.string().nullable().optional(),
  })

  app.put('/outcome-lyric-factors/:outcomeKey', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const outcomeKey = (req.params as any).outcomeKey as string
    const parsed = OutcomeLyricFactorBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    // Confirm the outcome family exists.
    const exists = await prisma.outcome.findFirst({ where: { outcomeKey }, select: { id: true } })
    if (!exists) return reply.code(404).send({ error: 'unknown_outcome' })
    const row = await prisma.outcomeLyricFactor.upsert({
      where: { outcomeKey },
      update: { templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, updatedById: op.operatorId },
      create: { outcomeKey, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, updatedById: op.operatorId },
    })
    return {
      outcomeKey: row.outcomeKey,
      templateText: row.templateText,
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString(),
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
          client: { select: { id: true, companyName: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.outcome.findMany({
        where: { supersededAt: null },
        select: { id: true, title: true, displayTitle: true, version: true },
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
        clientId: icp.client?.id ?? null,
        clientName: icp.client?.companyName ?? null,
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
          outcome: { select: { id: true, title: true, displayTitle: true, version: true } },
          songSeed: { select: { id: true, title: true } },
        },
      }),
      prisma.lineageRow.count({ where }),
    ])

    // Resolve ICP names + client/store context in one shot.
    const icpIds = [...new Set(rows.map((r) => r.icpId))]
    const icps = icpIds.length === 0 ? [] : await prisma.iCP.findMany({
      where: { id: { in: icpIds } },
      select: {
        id: true, name: true,
        client: { select: { id: true, companyName: true } },
        store: { select: { id: true, name: true } },
      },
    })
    const icpById = new Map(icps.map((i) => [i.id, i]))

    return {
      total, limit, offset,
      rows: rows.map((r) => {
        const i = icpById.get(r.icpId)
        return {
          id: r.id,
          active: r.active,
          createdAt: r.createdAt.toISOString(),
          icpId: r.icpId,
          icpName: i?.name ?? null,
          clientName: i?.client?.companyName ?? null,
          storeName: i?.store?.name ?? null,
          outcome: r.outcome,
          hook: r.hook,
          song: r.song,
          songTitle: r.songSeed?.title ?? null,
        }
      }),
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
          outcome: { select: { id: true, title: true, displayTitle: true, version: true } },
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
          outcome: { select: { id: true, title: true, displayTitle: true, version: true } },
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
      include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true } } },
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

  // Returns the system + user message that would be sent to Claude for the
  // given (ICP, Outcome, n). Read-only — does not call the model.
  app.get('/icps/:id/hook-writer/context', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const q = req.query as { outcomeId?: string; n?: string }
    if (!q.outcomeId) return reply.code(400).send({ error: 'bad_query', message: 'outcomeId required' })
    const n = Math.max(1, Math.min(20, Number(q.n ?? 5) || 5))
    try {
      const ctx = await buildHookDrafterContext({ icpId, outcomeId: q.outcomeId, n })
      return ctx
    } catch (e: any) {
      return reply.code(502).send({ error: 'context_build_failed', message: e.message ?? 'unknown' })
    }
  })

  // Bulk create hooks: same outcome, many entries. Accepts either the legacy
  // `texts: string[]` shape or the v2 `hooks: [{ text, vocalGender }]` shape.
  const HookBulkBody = z.object({
    outcomeId: z.string().uuid(),
    texts: z.array(z.string().min(1)).min(1).max(100).optional(),
    hooks: z
      .array(
        z.object({
          text: z.string().min(1),
          vocalGender: z.enum(['male', 'female', 'duet']).nullable().optional(),
        }),
      )
      .min(1)
      .max(100)
      .optional(),
    approve: z.boolean().optional(),
  }).refine((b) => !!b.texts || !!b.hooks, { message: 'Provide either texts or hooks' })

  app.post('/icps/:id/hooks/bulk', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const parsed = HookBulkBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const now = new Date()
      const entries: { text: string; vocalGender: string | null }[] = parsed.data.hooks
        ? parsed.data.hooks.map((h) => ({ text: h.text, vocalGender: h.vocalGender ?? null }))
        : (parsed.data.texts ?? []).map((text) => ({ text, vocalGender: null }))
      const data = entries.map((e) => ({
        icpId,
        outcomeId: parsed.data.outcomeId,
        text: e.text,
        vocalGender: e.vocalGender,
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
      const row = await prisma.hook.create({ data, include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true } } } })
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
      include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true } } },
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
      include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true } } },
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
      include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true } } },
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

    const queueHookIds = [...new Set(hendrix.queue.map((q) => q.hookId).filter(Boolean))]
    const queueHooks = queueHookIds.length
      ? await prisma.hook.findMany({ where: { id: { in: queueHookIds } }, select: { id: true, text: true } })
      : []
    const hookTextById = new Map(queueHooks.map((h) => [h.id, h.text]))
    const queueWithTitles = hendrix.queue.map((q) => ({
      ...q,
      hookText: hookTextById.get(q.hookId) ?? null,
      outcomeTitle: outcomeById.get(q.outcomeId)?.title ?? null,
      outcomeDisplayTitle: outcomeById.get(q.outcomeId)?.displayTitle ?? null,
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
        outcomeDisplayTitle: activeOutcomeRow?.displayTitle ?? null,
        source: hendrix.activeOutcome.source,
        expiresAt: hendrix.activeOutcome.expiresAt ?? null,
      } : null,
      queue: queueWithTitles,
      fallbackTier: hendrix.fallbackTier,
      reason: hendrix.reason,
      outcomes: outcomes.map((o) => ({
        outcomeId: o.id,
        title: o.title,
        displayTitle: o.displayTitle,
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
        outcomeDisplayTitle: e.outcomeId ? (outcomeById.get(e.outcomeId)?.displayTitle ?? null) : null,
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
      include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true } } },
    })
    return rows.map((r) => ({
      id: r.id,
      storeId: r.storeId,
      dayOfWeek: r.dayOfWeek,
      startTime: timeToHHMM(r.startTime),
      endTime: timeToHHMM(r.endTime),
      outcomeId: r.outcomeId,
      outcomeTitle: r.outcome.title,
      outcomeDisplayTitle: r.outcome.displayTitle,
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
        include: { outcome: { select: { title: true, displayTitle: true, version: true } } },
      })
      return {
        id: row.id, storeId: row.storeId, dayOfWeek: row.dayOfWeek,
        startTime: timeToHHMM(row.startTime), endTime: timeToHHMM(row.endTime),
        outcomeId: row.outcomeId, outcomeTitle: row.outcome.title, outcomeDisplayTitle: row.outcome.displayTitle, outcomeVersion: row.outcome.version,
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
        include: { outcome: { select: { title: true, displayTitle: true, version: true } } },
      })
      return {
        id: row.id, storeId: row.storeId, dayOfWeek: row.dayOfWeek,
        startTime: timeToHHMM(row.startTime), endTime: timeToHHMM(row.endTime),
        outcomeId: row.outcomeId, outcomeTitle: row.outcome.title, outcomeDisplayTitle: row.outcome.displayTitle, outcomeVersion: row.outcome.version,
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
        defaultOutcome: { select: { id: true, title: true, displayTitle: true, version: true, supersededAt: true } },
      },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const dryRunIcpIds = store.icps.map((i) => i.id)

    const rows = await prisma.scheduleSlot.findMany({
      where: { storeId },
      include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true, supersededAt: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    })

    const DAY_SEC = 86400
    const dayLabels = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const fmtHHMM = (sec: number) => {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    const def = store.defaultOutcome ?? null
    const usedOutcomes = new Map<string, { id: string; title: string; displayTitle: string | null; version: number; superseded: boolean }>()
    if (def) usedOutcomes.set(def.id, { id: def.id, title: def.title, displayTitle: def.displayTitle, version: def.version, superseded: !!def.supersededAt })

    type Period = {
      startSec: number; endSec: number
      startHHMM: string; endHHMM: string
      source: 'schedule' | 'default' | 'gap'
      outcomeId: string | null
      outcomeTitle: string | null
      outcomeDisplayTitle: string | null
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
            outcomeId: def.id, outcomeTitle: def.title, outcomeDisplayTitle: def.displayTitle, outcomeVersion: def.version,
            outcomeSuperseded: !!def.supersededAt,
            durationMin: Math.round((to - from) / 60),
            overlap: false,
          })
        } else {
          periods.push({
            startSec: from, endSec: to,
            startHHMM: fmtHHMM(from), endHHMM: fmtHHMM(to),
            source: 'gap',
            outcomeId: null, outcomeTitle: null, outcomeDisplayTitle: null, outcomeVersion: null,
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
          id: r.outcome.id, title: r.outcome.title, displayTitle: r.outcome.displayTitle, version: r.outcome.version,
          superseded: !!r.outcome.supersededAt,
        })
        periods.push({
          startSec: start, endSec: end,
          startHHMM: fmtHHMM(start), endHHMM: fmtHHMM(end),
          source: 'schedule',
          outcomeId: r.outcome.id, outcomeTitle: r.outcome.title, outcomeDisplayTitle: r.outcome.displayTitle, outcomeVersion: r.outcome.version,
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
        outcomeId: o.id, outcomeTitle: o.title, outcomeDisplayTitle: o.displayTitle, outcomeVersion: o.version,
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
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })

  app.get('/song-seeds', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = SongSeedsListQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_query', details: parsed.error.flatten() })
    const where: any = {}
    if (parsed.data.icpId) where.icpId = parsed.data.icpId
    if (parsed.data.status) where.status = parsed.data.status
    const rows = await prisma.songSeed.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: parsed.data.limit ?? 100,
      include: {
        hook: { select: { id: true, text: true } },
        outcome: { select: { id: true, title: true, displayTitle: true, version: true } },
        referenceTrack: { select: { id: true, artist: true, title: true, coverUrl: true } },
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

  app.delete('/song-seeds/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.songSeed.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued', message: `SongSeed is ${existing.status}; only queued prompts can be deleted` })
    await prisma.songSeed.delete({ where: { id } })
    return { ok: true }
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

  // POST /admin/song-seeds/:id/accept-files — multipart file upload alternative to URL-paste accept
  app.post('/song-seeds/:id/accept-files', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string

    const existing = await prisma.songSeed.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued', message: `SongSeed is ${existing.status}` })

    const uploaded: { url: string; key: string; byteSize: number; contentType: string }[] = []
    let i = 0
    try {
      for await (const part of req.files()) {
        const buf = await part.toBuffer()
        const key = `song-seeds/${id}/take-${++i}-${Date.now()}.mp3`
        const obj = await uploadBuffer(key, buf, 'audio/mpeg')
        uploaded.push(obj)
      }
    } catch (e: any) {
      return reply.code(502).send({ error: 'r2_upload_failed', message: e.message ?? 'unknown' })
    }

    if (uploaded.length === 0) return reply.code(400).send({ error: 'no_files' })

    const outcome = await prisma.outcome.findUnique({ where: { id: existing.outcomeId }, select: { version: true } })
    try {
      const result = await prisma.$transaction(async (tx) => {
        const lineage: any[] = []
        for (const obj of uploaded) {
          const song = await tx.song.upsert({
            where: { r2Url: obj.url },
            create: { r2Url: obj.url, r2ObjectKey: obj.key, byteSize: BigInt(obj.byteSize), contentType: obj.contentType },
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
        const updated = await tx.songSeed.update({
          where: { id }, data: { status: 'accepted', terminalAt: new Date() },
        })
        if (existing.referenceTrackId) {
          await tx.referenceTrack.update({ where: { id: existing.referenceTrackId }, data: { useCount: { increment: 1 } } })
        }
        await tx.hook.update({ where: { id: existing.hookId }, data: { useCount: { increment: 1 } } })
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

  // ── Card 21 POS Ingestion ─────────────────────────────────────

  const POSEventRow = z.object({
    occurredAt: z.string().datetime({ offset: true }),
    transactionValueCents: z.number().int().nonnegative(),
    currency: z.string().length(3).default('USD'),
    itemCount: z.number().int().nonnegative(),
    posExternalId: z.string().optional(),
  })

  const POSIngestBody = z.object({
    posProvider: z.string().min(1).default('manual_csv'),
    pullWindowStart: z.string().datetime({ offset: true }),
    pullWindowEnd: z.string().datetime({ offset: true }),
    events: z.array(POSEventRow).min(1).max(50000),
  })

  // POST /admin/stores/:storeId/pos/ingest
  app.post('/stores/:storeId/pos/ingest', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).storeId as string

    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, clientId: true } })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })

    const parsed = POSIngestBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const { posProvider, pullWindowStart, pullWindowEnd, events } = parsed.data

    const run = await prisma.pOSPullRun.create({
      data: {
        clientId: store.clientId,
        storeId,
        posProvider,
        pullWindowStart: new Date(pullWindowStart),
        pullWindowEnd: new Date(pullWindowEnd),
        status: 'running',
        triggeredBy: 'manual',
        triggeredById: op.operatorId,
      },
    })

    let ingested = 0
    let skipped = 0
    const errors: string[] = []

    for (const evt of events) {
      try {
        await prisma.pOSEvent.upsert({
          where: {
            posProvider_posExternalId: {
              posProvider,
              posExternalId: evt.posExternalId ?? `${run.id}:${ingested + skipped}`,
            },
          },
          create: {
            storeId,
            clientId: store.clientId,
            posProvider,
            posExternalId: evt.posExternalId ?? null,
            occurredAt: new Date(evt.occurredAt),
            transactionValueCents: BigInt(evt.transactionValueCents),
            currency: evt.currency,
            itemCount: evt.itemCount,
            posPullRunId: run.id,
          },
          update: {},
        })
        ingested++
      } catch (e: any) {
        skipped++
        if (errors.length < 10) errors.push(e.message ?? String(e))
      }
    }

    await prisma.pOSPullRun.update({
      where: { id: run.id },
      data: {
        status: errors.length > 0 && ingested === 0 ? 'failed' : 'success',
        finishedAt: new Date(),
        eventsIngested: ingested,
        unmappedCount: 0,
        errorText: errors.length > 0 ? errors.join('; ') : null,
      },
    })

    return { runId: run.id, ingested, skipped, errors }
  })

  // GET /admin/stores/:storeId/pos/runs
  app.get('/stores/:storeId/pos/runs', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).storeId as string
    const runs = await prisma.pOSPullRun.findMany({
      where: { storeId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    })
    return runs.map((r) => ({
      id: r.id,
      posProvider: r.posProvider,
      pullWindowStart: r.pullWindowStart.toISOString(),
      pullWindowEnd: r.pullWindowEnd.toISOString(),
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      status: r.status,
      eventsIngested: r.eventsIngested,
      triggeredBy: r.triggeredBy,
    }))
  })

  // GET /admin/stores/:storeId/pos/summary
  app.get('/stores/:storeId/pos/summary', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).storeId as string
    const [totalEvents, earliest, latest] = await Promise.all([
      prisma.pOSEvent.count({ where: { storeId } }),
      prisma.pOSEvent.findFirst({ where: { storeId }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
      prisma.pOSEvent.findFirst({ where: { storeId }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    ])
    return {
      totalEvents,
      earliestAt: earliest?.occurredAt.toISOString() ?? null,
      latestAt: latest?.occurredAt.toISOString() ?? null,
    }
  })

  // ── RetailNext Ingestion ────────────────────────────────────────

  // POST /admin/stores/:storeId/retailnext/ingest-xls
  // Accepts a multipart XLS file (RetailNext "Daily Comprehensive Traffic Report").
  // Parses Sheet1 (daily summary) and Sheet2 (hourly breakdown) and upserts snapshots.
  app.post('/stores/:storeId/retailnext/ingest-xls', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).storeId as string

    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })

    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no_file' })

    const buf = await file.toBuffer()
    let parsed: Awaited<ReturnType<typeof parseRetailNextXls>>
    try {
      parsed = parseRetailNextXls(buf)
    } catch (e: any) {
      return reply.code(422).send({ error: 'parse_failed', message: e.message ?? String(e) })
    }

    const { daily, hourly } = parsed
    const run = await prisma.retailNextIngestRun.create({
      data: {
        storeId,
        reportDate: daily.reportDate,
        filename: file.filename || null,
        status: 'running',
        triggeredById: op.operatorId,
      },
    })

    let rowsIngested = 0
    try {
      await prisma.retailNextDailySnapshot.upsert({
        where: { storeId_date: { storeId, date: daily.reportDate } },
        create: {
          storeId,
          date: daily.reportDate,
          retailNextStoreId: daily.retailNextStoreId,
          traffic: daily.traffic,
          salesCents: daily.salesCents,
          saleTrxCount: daily.saleTrxCount,
          returnTrxCount: daily.returnTrxCount,
          convRate: daily.convRate,
          atv: daily.atv,
          shopperYield: daily.shopperYield,
          captureRate: daily.captureRate,
          newShopperPct: daily.newShopperPct,
          visitDurationSecs: daily.visitDurationSecs,
          weather: daily.weather,
          ingestRunId: run.id,
        },
        update: {
          retailNextStoreId: daily.retailNextStoreId,
          traffic: daily.traffic,
          salesCents: daily.salesCents,
          saleTrxCount: daily.saleTrxCount,
          returnTrxCount: daily.returnTrxCount,
          convRate: daily.convRate,
          atv: daily.atv,
          shopperYield: daily.shopperYield,
          captureRate: daily.captureRate,
          newShopperPct: daily.newShopperPct,
          visitDurationSecs: daily.visitDurationSecs,
          weather: daily.weather,
          ingestRunId: run.id,
        },
      })
      rowsIngested++

      for (const h of hourly) {
        await prisma.retailNextHourlySnapshot.upsert({
          where: { storeId_date_hourStart: { storeId, date: h.date, hourStart: h.hourStart } },
          create: {
            storeId,
            date: h.date,
            hourStart: h.hourStart,
            traffic: h.traffic,
            salesCents: h.salesCents,
            saleTrxCount: h.saleTrxCount,
            returnTrxCount: h.returnTrxCount,
            convRate: h.convRate,
            atv: h.atv,
            shopperYield: h.shopperYield,
            captureRate: h.captureRate,
            visitDurationSecs: h.visitDurationSecs,
            ingestRunId: run.id,
          },
          update: {
            traffic: h.traffic,
            salesCents: h.salesCents,
            saleTrxCount: h.saleTrxCount,
            returnTrxCount: h.returnTrxCount,
            convRate: h.convRate,
            atv: h.atv,
            shopperYield: h.shopperYield,
            captureRate: h.captureRate,
            visitDurationSecs: h.visitDurationSecs,
            ingestRunId: run.id,
          },
        })
        rowsIngested++
      }

      await prisma.retailNextIngestRun.update({
        where: { id: run.id },
        data: { status: 'success', finishedAt: new Date(), rowsIngested },
      })

      return { runId: run.id, reportDate: daily.reportDate.toISOString().slice(0, 10), rowsIngested }
    } catch (e: any) {
      await prisma.retailNextIngestRun.update({
        where: { id: run.id },
        data: { status: 'failed', finishedAt: new Date(), errorText: e.message ?? String(e) },
      })
      return reply.code(500).send({ error: 'ingest_failed', message: e.message ?? String(e) })
    }
  })

  // GET /admin/stores/:storeId/retailnext/runs
  app.get('/stores/:storeId/retailnext/runs', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).storeId as string
    const runs = await prisma.retailNextIngestRun.findMany({
      where: { storeId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    })
    return runs.map((r) => ({
      id: r.id,
      reportDate: r.reportDate.toISOString().slice(0, 10),
      filename: r.filename,
      status: r.status,
      rowsIngested: r.rowsIngested,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      errorText: r.errorText,
    }))
  })

  // ── Card 22 Campaigns ──────────────────────────────────────────

  function serializeCampaign(c: {
    id: string; storeId: string; name: string; startsAt: Date; endsAt: Date
    songsPerAd: number; createdAt: Date; updatedAt: Date
    adAssets: { id: string; campaignId: string; r2Url: string; r2ObjectKey: string; label: string | null; position: number; byteSize: bigint | null; contentType: string | null; createdAt: Date }[]
  }) {
    return {
      id: c.id,
      storeId: c.storeId,
      name: c.name,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      songsPerAd: c.songsPerAd,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      adAssets: c.adAssets
        .sort((a, b) => a.position - b.position)
        .map((a) => ({
          id: a.id,
          campaignId: a.campaignId,
          r2Url: a.r2Url,
          label: a.label,
          position: a.position,
          byteSize: a.byteSize ? Number(a.byteSize) : null,
          contentType: a.contentType,
          createdAt: a.createdAt.toISOString(),
        })),
    }
  }

  const campaignInclude = {
    adAssets: true,
  } as const

  // GET /admin/stores/:storeId/campaigns
  app.get('/stores/:storeId/campaigns', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).storeId as string
    const campaigns = await prisma.campaign.findMany({
      where: { storeId },
      include: campaignInclude,
      orderBy: { startsAt: 'asc' },
    })
    return campaigns.map(serializeCampaign)
  })

  // POST /admin/stores/:storeId/campaigns
  app.post('/stores/:storeId/campaigns', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const storeId = (req.params as any).storeId as string
    const body = z.object({
      name: z.string().min(1),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      songsPerAd: z.number().int().min(1).default(3),
    }).parse(req.body)
    const campaign = await prisma.campaign.create({
      data: {
        storeId,
        name: body.name,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        songsPerAd: body.songsPerAd,
      },
      include: campaignInclude,
    })
    return reply.code(201).send(serializeCampaign(campaign))
  })

  // PUT /admin/campaigns/:id
  app.put('/campaigns/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const body = z.object({
      name: z.string().min(1).optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
      songsPerAd: z.number().int().min(1).optional(),
    }).parse(req.body)
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.startsAt !== undefined && { startsAt: new Date(body.startsAt) }),
        ...(body.endsAt !== undefined && { endsAt: new Date(body.endsAt) }),
        ...(body.songsPerAd !== undefined && { songsPerAd: body.songsPerAd }),
      },
      include: campaignInclude,
    })
    return serializeCampaign(campaign)
  })

  // DELETE /admin/campaigns/:id
  app.delete('/campaigns/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    await prisma.campaign.delete({ where: { id } })
    return { ok: true }
  })

  // POST /admin/campaigns/:campaignId/assets — paste a source URL, server downloads + re-hosts to R2
  app.post('/campaigns/:campaignId/assets', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const campaignId = (req.params as any).campaignId as string
    const body = z.object({
      sourceUrl: z.string().url(),
      label: z.string().optional(),
    }).parse(req.body)

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { adAssets: { select: { position: true } } },
    })
    if (!campaign) return reply.code(404).send({ error: 'not_found' })

    const nextPosition = campaign.adAssets.length > 0
      ? Math.max(...campaign.adAssets.map((a) => a.position)) + 1
      : 0

    const assetId = crypto.randomUUID()
    const key = `ads/${assetId}.mp3`
    let uploaded: { url: string; byteSize: number; contentType: string }
    try {
      uploaded = await downloadAndUploadFromUrl(body.sourceUrl, key)
    } catch (e: any) {
      return reply.code(502).send({ error: 'upload_failed', message: e.message ?? 'unknown' })
    }

    const asset = await prisma.adAsset.create({
      data: {
        id: assetId,
        campaignId,
        r2Url: uploaded.url,
        r2ObjectKey: key,
        label: body.label ?? null,
        position: nextPosition,
        byteSize: uploaded.byteSize,
        contentType: uploaded.contentType,
      },
    })

    return reply.code(201).send({
      id: asset.id,
      campaignId: asset.campaignId,
      r2Url: asset.r2Url,
      label: asset.label,
      position: asset.position,
      byteSize: asset.byteSize ? Number(asset.byteSize) : null,
      contentType: asset.contentType,
      createdAt: asset.createdAt.toISOString(),
    })
  })

  // POST /admin/campaigns/:campaignId/assets/upload — direct file upload to R2
  app.post('/campaigns/:campaignId/assets/upload', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const campaignId = (req.params as any).campaignId as string

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { adAssets: { select: { position: true } } },
    })
    if (!campaign) return reply.code(404).send({ error: 'not_found' })

    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no_file' })

    const label = (file.fields as any)?.label?.value as string | undefined
    const buf = await file.toBuffer()
    const assetId = crypto.randomUUID()
    const key = `ads/${assetId}.mp3`

    let uploaded: { url: string; byteSize: number; contentType: string }
    try {
      uploaded = await uploadBuffer(key, buf, 'audio/mpeg')
    } catch (e: any) {
      return reply.code(502).send({ error: 'upload_failed', message: e.message ?? 'unknown' })
    }

    const nextPosition = campaign.adAssets.length > 0
      ? Math.max(...campaign.adAssets.map((a) => a.position)) + 1
      : 0

    const asset = await prisma.adAsset.create({
      data: {
        id: assetId,
        campaignId,
        r2Url: uploaded.url,
        r2ObjectKey: key,
        label: label ?? null,
        position: nextPosition,
        byteSize: uploaded.byteSize,
        contentType: uploaded.contentType,
      },
    })

    return reply.code(201).send({
      id: asset.id,
      campaignId: asset.campaignId,
      r2Url: asset.r2Url,
      label: asset.label,
      position: asset.position,
      byteSize: asset.byteSize ? Number(asset.byteSize) : null,
      contentType: asset.contentType,
      createdAt: asset.createdAt.toISOString(),
    })
  })

  // DELETE /admin/ad-assets/:id
  app.delete('/ad-assets/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const asset = await prisma.adAsset.findUnique({ where: { id }, select: { campaignId: true, position: true } })
    if (!asset) return reply.code(404).send({ error: 'not_found' })
    await prisma.adAsset.delete({ where: { id } })
    // Re-sequence positions so they remain contiguous
    const remaining = await prisma.adAsset.findMany({
      where: { campaignId: asset.campaignId },
      orderBy: { position: 'asc' },
    })
    await Promise.all(remaining.map((a, i) =>
      prisma.adAsset.update({ where: { id: a.id }, data: { position: i } }),
    ))
    return { ok: true }
  })

  // PUT /admin/ad-assets/:id/move — shift position up or down by one
  app.put('/ad-assets/:id/move', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const { direction } = z.object({ direction: z.enum(['up', 'down']) }).parse(req.body)

    const asset = await prisma.adAsset.findUnique({ where: { id } })
    if (!asset) return reply.code(404).send({ error: 'not_found' })

    const siblings = await prisma.adAsset.findMany({
      where: { campaignId: asset.campaignId },
      orderBy: { position: 'asc' },
    })
    const idx = siblings.findIndex((a) => a.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return { ok: true }

    const swapWith = siblings[swapIdx]!
    await Promise.all([
      prisma.adAsset.update({ where: { id: asset.id }, data: { position: swapWith.position } }),
      prisma.adAsset.update({ where: { id: swapWith.id }, data: { position: asset.position } }),
    ])
    return { ok: true }
  })
}
