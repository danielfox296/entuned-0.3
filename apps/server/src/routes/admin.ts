// Admin routes — gated by isAdmin on the operator. Used by apps/admin.
//
// Surface:
//   GET    /admin/musicological-rules            — latest + history
//   POST   /admin/musicological-rules            — new versioned row { rulesText, notes? }
//   GET    /admin/failure-rules                  — full table
//   POST   /admin/failure-rules                  — create one
//   PUT    /admin/failure-rules/:id              — update one
//   DELETE /admin/failure-rules/:id              — delete one
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
import { decompose } from '../lib/decomposer/decomposer.js'
import { nextQueue } from '../lib/hendrix.js'
import { setOverride, clearOverride } from '../lib/outcomeSchedule.js'
import { runEno } from '../lib/eno/eno.js'
import { downloadAndUploadFromUrl } from '../lib/r2.js'
import { draftHooks, getOrSeedDrafterPrompt } from '../lib/hooks/drafter.js'

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

const FailureRuleBody = z.object({
  triggerField: z.string().min(1),
  triggerValue: z.string(),
  exclude: z.string().min(1),
  overrideField: z.string().nullable().optional(),
  overridePattern: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

const StyleTemplatePostBody = z.object({ templateText: z.string().min(1), notes: z.string().optional() })

const OutcomePrependPostBody = z.object({ templateText: z.string(), notes: z.string().optional() })

const LyricPromptPostBody = z.object({ promptText: z.string().min(1), notes: z.string().optional() })

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // ----- MusicologicalRules -----

  app.get('/musicological-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const all = await prisma.musicologicalRules.findMany({ orderBy: { version: 'desc' } })
    return { latest: all[0] ?? null, history: all }
  })

  app.post('/musicological-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = RulesPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.musicologicalRules.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.musicologicalRules.create({
      data: { version: next, rulesText: parsed.data.rulesText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
  })

  // ----- FailureRules -----

  app.get('/failure-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.failureRule.findMany({ orderBy: { triggerField: 'asc' } })
    return rows
  })

  app.post('/failure-rules', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = FailureRuleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const row = await prisma.failureRule.create({
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

  app.put('/failure-rules/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = FailureRuleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.failureRule.update({
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

  app.delete('/failure-rules/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await prisma.failureRule.delete({ where: { id } })
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

  // ----- OutcomePrependTemplate (Card 14 — currently a no-op by design) -----

  app.get('/outcome-prepend-template', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const all = await prisma.outcomePrependTemplate.findMany({ orderBy: { version: 'desc' } })
    return { latest: all[0] ?? null, history: all }
  })

  app.post('/outcome-prepend-template', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = OutcomePrependPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.outcomePrependTemplate.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.outcomePrependTemplate.create({
      data: { version: next, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, createdById: op.operatorId },
    })
    return row
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

  app.get('/stores', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.store.findMany({
      orderBy: [{ client: { companyName: 'asc' } }, { name: 'asc' }],
      include: { client: { select: { companyName: true } } },
    })
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      timezone: s.timezone,
      clientId: s.clientId,
      clientName: s.client.companyName,
      icpId: s.icpId,
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
    const icp = await prisma.iCP.findUnique({
      where: { id: store.icpId },
      include: {
        referenceTracks: {
          orderBy: [{ bucket: 'asc' }, { artist: 'asc' }, { title: 'asc' }],
          include: { decomposition: true },
        },
      },
    })
    if (!icp) return reply.code(404).send({ error: 'icp_not_found' })
    const sharingStores = await prisma.store.findMany({
      where: { icpId: store.icpId, NOT: { id: store.id } },
      select: { id: true, name: true, client: { select: { companyName: true } } },
    })
    return {
      store: {
        id: store.id,
        name: store.name,
        timezone: store.timezone,
        clientId: store.client.id,
        clientName: store.client.companyName,
      },
      icp,
      sharedWith: sharingStores.map((s) => ({ id: s.id, name: s.name, clientName: s.client.companyName })),
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

  // --- Decompose now: runs Claude with web search; upserts Decomposition row. ---
  // Always overwrites the existing draft; verified rows return 409 unless ?force=1.
  app.post('/reference-tracks/:id/decompose', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const force = (req.query as any)?.force === '1'
    const ref = await prisma.referenceTrack.findUnique({
      where: { id },
      include: { decomposition: true },
    })
    if (!ref) return reply.code(404).send({ error: 'not_found' })
    if (ref.decomposition && ref.decomposition.status === 'verified' && !force) {
      return reply.code(409).send({ error: 'verified_decomposition_exists', message: 'Pass ?force=1 to overwrite a verified decomposition.' })
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
      musicologicalRulesVersion: result.rulesVersion,
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
    const row = await prisma.decomposition.upsert({
      where: { referenceTrackId: id },
      create: { referenceTrackId: id, ...data },
      update: data,
    })
    return row
  })

  // --- Hand-edit a Decomposition. status drives draft/verified lifecycle. ---
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
        createdById: op.operatorId,
      },
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
            createdById: op.operatorId,
          },
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

  app.get('/icps/:id/hook-drafter-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const row = await getOrSeedDrafterPrompt(icpId)
    return row
  })

  const HookDrafterPromptBody = z.object({ promptText: z.string().min(1) })

  app.put('/icps/:id/hook-drafter-prompt', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.params as any).id as string
    const parsed = HookDrafterPromptBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const row = await prisma.hookDrafterPrompt.upsert({
      where: { icpId },
      create: { icpId, promptText: parsed.data.promptText, updatedById: op.operatorId },
      update: { promptText: parsed.data.promptText, updatedById: op.operatorId },
    })
    return row
  })

  const DraftHooksBody = z.object({
    outcomeId: z.string().uuid(),
    n: z.number().int().min(1).max(20),
  })

  app.post('/icps/:id/hook-drafter/run', async (req, reply) => {
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
    const row = await prisma.hook.update({
      where: { id },
      data: { status: 'approved', approvedAt: new Date(), approvedById: op.operatorId },
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
      include: { client: { select: { companyName: true } } },
    })
    if (!store) return reply.code(404).send({ error: 'not_found' })

    const [hendrix, outcomes, lineageCounts, events] = await Promise.all([
      nextQueue(id),
      prisma.outcome.findMany({ where: { supersededAt: null }, orderBy: { title: 'asc' } }),
      prisma.lineageRow.groupBy({
        by: ['outcomeId'],
        where: { icpId: store.icpId, active: true },
        _count: { _all: true },
      }),
      prisma.audioEvent.findMany({
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
        icpId: store.icpId,
        defaultOutcomeId: store.defaultOutcomeId,
        manualOverrideOutcomeId: store.manualOverrideOutcomeId,
        manualOverrideExpiresAt: store.manualOverrideExpiresAt,
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

  app.post('/stores/:id/override', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = OverrideBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const { outcomeId, expiresAt } = await setOverride(id, parsed.data.outcomeId)
      await prisma.audioEvent.create({
        data: {
          eventType: 'outcome_override',
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

  app.post('/stores/:id/override/clear', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await clearOverride(id)
      await prisma.audioEvent.create({
        data: {
          eventType: 'outcome_override_cleared',
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
    const rows = await prisma.scheduleRow.findMany({
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
    try {
      const row = await prisma.scheduleRow.create({
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
    try {
      const row = await prisma.scheduleRow.update({
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
      await prisma.scheduleRow.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
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

  const SubmissionsListQuery = z.object({
    icpId: z.string().uuid().optional(),
    status: z.string().optional(),
    claimedBy: z.string().optional(), // 'me' | 'unclaimed' | uuid
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })

  app.get('/submissions', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = SubmissionsListQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_query', details: parsed.error.flatten() })
    const where: any = {}
    if (parsed.data.icpId) where.icpId = parsed.data.icpId
    if (parsed.data.status) where.status = parsed.data.status
    if (parsed.data.claimedBy === 'unclaimed') where.claimedById = null
    else if (parsed.data.claimedBy === 'me') where.claimedById = op.operatorId
    else if (parsed.data.claimedBy) where.claimedById = parsed.data.claimedBy
    const rows = await prisma.submission.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: parsed.data.limit ?? 100,
      include: {
        hook: { select: { id: true, text: true } },
        outcome: { select: { id: true, title: true, version: true } },
        referenceTrack: { select: { id: true, artist: true, title: true } },
        enoRun: { select: { id: true, startedAt: true, triggeredBy: true } },
      },
    })
    return rows
  })

  app.get('/submissions/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const row = await prisma.submission.findUnique({
      where: { id },
      include: {
        hook: { select: { id: true, text: true } },
        outcome: true,
        referenceTrack: { include: { decomposition: true } },
        enoRun: true,
        lineageRows: { include: { song: true } },
      },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  const EnoRunBody = z.object({
    icpId: z.string().uuid(),
    outcomeId: z.string().uuid(),
    n: z.number().int().min(1).max(20),
  })

  app.post('/eno/run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = EnoRunBody.safeParse(req.body)
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

  app.post('/submissions/:id/claim', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.submission.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued', message: `Submission is ${existing.status}` })
    if (existing.claimedById && existing.claimedById !== op.operatorId) {
      return reply.code(409).send({ error: 'already_claimed' })
    }
    const row = await prisma.submission.update({
      where: { id }, data: { claimedById: op.operatorId, claimedAt: new Date() },
    })
    return row
  })

  app.post('/submissions/:id/release', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.submission.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued' })
    const row = await prisma.submission.update({
      where: { id }, data: { claimedById: null, claimedAt: null },
    })
    return row
  })

  app.post('/submissions/:id/skip', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.submission.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued' })
    const row = await prisma.submission.update({
      where: { id }, data: { status: 'skipped', terminalAt: new Date() },
    })
    return row
  })

  app.post('/submissions/:id/abandon', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const existing = await prisma.submission.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued' })
    const row = await prisma.submission.update({
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

  app.post('/submissions/:id/accept', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = AcceptBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })

    const existing = await prisma.submission.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') return reply.code(409).send({ error: 'not_queued', message: `Submission is ${existing.status}` })

    // Step 1: download + reupload each take to R2 BEFORE opening the transaction.
    // R2 puts are external I/O — keeping them out of the DB transaction avoids
    // long-held DB connections.
    const uploaded: { url: string; key: string; byteSize: number; contentType: string }[] = []
    try {
      for (let i = 0; i < parsed.data.takes.length; i++) {
        const take = parsed.data.takes[i]!
        const key = `submissions/${id}/take-${i + 1}-${Date.now()}.mp3`
        const obj = await downloadAndUploadFromUrl(take.sourceUrl, key)
        uploaded.push(obj)
      }
    } catch (e: any) {
      return reply.code(502).send({ error: 'r2_upload_failed', message: e.message ?? 'unknown' })
    }

    // Step 2: persist (Songs + LineageRows + Submission flip + useCount bump) in one transaction.
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
              hookId: existing.hookId,
              submissionId: existing.id,
              active: true,
            },
          })
          lineage.push(row)
        }
        // Status flip — partial unique on (hook_id) WHERE status='accepted' enforces 1-per-hook.
        const updated = await tx.submission.update({
          where: { id }, data: { status: 'accepted', terminalAt: new Date() },
        })
        if (existing.referenceTrackId) {
          await tx.referenceTrack.update({
            where: { id: existing.referenceTrackId },
            data: { useCount: { increment: 1 } },
          })
        }
        return { submission: updated, lineageRows: lineage }
      })
      return result
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.code(409).send({ error: 'hook_already_accepted', message: 'Another submission for this hook has already been accepted.' })
      }
      return reply.code(500).send({ error: 'accept_failed', message: e.message ?? 'unknown' })
    }
  })

  app.put('/decompositions/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = DecompositionUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const data: any = { ...parsed.data }
    if (parsed.data.status === 'verified') {
      data.verifiedAt = new Date()
      data.verifiedById = op.operatorId
    } else if (parsed.data.status === 'draft') {
      data.verifiedAt = null
      data.verifiedById = null
    }
    try {
      const row = await prisma.decomposition.update({ where: { id }, data })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })
}
