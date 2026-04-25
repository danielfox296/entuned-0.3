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
    const rows = await prisma.outcome.findMany({
      where: { supersededAt: null },
      orderBy: [{ title: 'asc' }],
    })
    return rows
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
