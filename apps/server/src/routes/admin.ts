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
//   GET    /admin/mars-prompts                   — { anchor: { latest, history }, router: { latest, history } }
//   POST   /admin/mars-prompts/anchor            — new anchor prompt version
//   POST   /admin/mars-prompts/router            — new router prompt version
//   POST   /admin/email/preview                  — render or test-send an email template
//                                                  (gated by INTERNAL_ADMIN_TOKEN, header x-admin-token)

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { verify } from '../lib/auth.js'
import bcrypt from 'bcryptjs'
import { decompose } from '../lib/decomposer/decomposer.js'
import { lookupBpm } from '../lib/decomposer/bpm-lookup.js'
import { pickSystemDefaultOutcomeId, isFreeTierAllowedOutcome } from '../lib/outcomes.js'
import { nextQueue } from '../lib/hendrix.js'
import { setOverride, clearOverride } from '../lib/outcomeSchedule.js'
import { runEno } from '../lib/eno/eno.js'
import { FREE_TIER_ICP_ID, FREE_TIER_AD_STORE_ID, FREE_TIER_CLIENT_ID } from '../lib/freeTier.js'
import { downloadAndUploadFromUrl, uploadBuffer } from '../lib/r2.js'
import { draftHooks, getOrSeedHookWriterPrompt, buildHookDrafterContext } from '../lib/hooks/drafter.js'
import { suggestReferenceTracks } from '../lib/ref-tracks/suggester.js'
import { uniqueStoreSlug } from '../lib/account.js'
import { resolvePreview } from '../lib/ref-tracks/preview.js'
import { parseRetailNextXls } from '../lib/retailnext/parser.js'
import { renderTemplate, sendTemplate, TEMPLATE_PROPS_EXAMPLES } from '../lib/email.js'
import { LIFECYCLE_TEMPLATES, TEMPLATES, type TemplateName } from '../email-templates/index.js'
import { EDITABLE_TEMPLATE_NAMES } from '../email-templates/seeds.js'
import { runOneLifecycleDrip, runLifecycleEmails, type LifecycleDripName } from '../lib/lifecycleEmails.js'
import { runPauseAutoResume } from '../lib/pauseAutoResume.js'
import { runCompExpiryCron } from '../lib/compExpiry.js'
import { effectiveTier, compIsActive, tierRank, applyTierChange, type Tier } from '../lib/tier.js'
import {
  timeToHHMM,
  hhmmToTime,
  hhmmToSec,
  ScheduleSlotBody,
  findOverlappingSlot,
} from '../lib/scheduleSlots.js'

interface AuthedOp {
  accountId: string
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
  // Re-verify the operator is still active and the token's version matches
  // the operator's current tokenVersion (bumped on password change / revoke).
  const op = await prisma.account.findUnique({ where: { id: payload.accountId } })
  if (!op || op.disabledAt || !op.isAdmin) {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }
  if (op.tokenVersion !== payload.tv) {
    reply.code(401).send({ error: 'token_revoked' })
    return null
  }
  return { accountId: op.id, email: op.email, isAdmin: op.isAdmin }
}

// Time helpers + ScheduleSlotBody schema live in ../lib/scheduleSlots.js
// (shared with /me/* routes — see ASSESSMENT.md §2.2).

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

const LyricBanEntryBody = z.object({
  category: z.enum(['overused_word', 'cliche_phrase', 'cliche_shape']),
  text: z.string().min(1),
  note: z.string().nullable().optional(),
})

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
      data: { version: next, rulesText: parsed.data.rulesText, notes: parsed.data.notes ?? null, createdById: op.accountId },
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
      data: { version: next, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, createdById: op.accountId },
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
      data: { version: next, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, createdById: op.accountId },
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
      data: { version: next, templateText: parsed.data.templateText, notes: parsed.data.notes ?? null, createdById: op.accountId },
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
      data: { version: next, promptText: parsed.data.promptText, notes: parsed.data.notes ?? null, createdById: op.accountId },
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
      data: { version: next, promptText: parsed.data.promptText, notes: parsed.data.notes ?? null, createdById: op.accountId },
    })
    return row
  })

  // ----- Mars system prompts (anchor + router) -----
  // DB-backed system prompts for the two LLM-driven Mars style builders.
  // Same shape as /lyric-prompts. Schema SSOT:
  //   ../../../entune v0.3/schema/light-cards.md (Card 12 — Mars,
  //   "StyleAnchorPrompt and StyleRouterPrompt" section).
  // Cold-start v1 happens in lib/mars/style-{anchor,router}.ts on first call.

  app.get('/mars-prompts', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const [anchorAll, routerAll] = await Promise.all([
      prisma.styleAnchorPrompt.findMany({ orderBy: { version: 'desc' } }),
      prisma.styleRouterPrompt.findMany({ orderBy: { version: 'desc' } }),
    ])
    return {
      anchor: { latest: anchorAll[0] ?? null, history: anchorAll },
      router: { latest: routerAll[0] ?? null, history: routerAll },
    }
  })

  app.post('/mars-prompts/anchor', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = LyricPromptPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.styleAnchorPrompt.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.styleAnchorPrompt.create({
      data: { version: next, promptText: parsed.data.promptText, notes: parsed.data.notes ?? null, createdById: op.accountId },
    })
    return row
  })

  app.post('/mars-prompts/router', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = LyricPromptPostBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const max = await prisma.styleRouterPrompt.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await prisma.styleRouterPrompt.create({
      data: { version: next, promptText: parsed.data.promptText, notes: parsed.data.notes ?? null, createdById: op.accountId },
    })
    return row
  })

  // ----- LyricBanEntries (overused words / cliché phrases / cliché shapes) -----

  app.get('/lyric-ban-entries', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.lyricBanEntry.findMany({ orderBy: [{ category: 'asc' }, { text: 'asc' }] })
    return rows
  })

  app.post('/lyric-ban-entries', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = LyricBanEntryBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.lyricBanEntry.create({
        data: { category: parsed.data.category, text: parsed.data.text, note: parsed.data.note ?? null },
      })
      return row
    } catch (e: any) {
      if (e?.code === 'P2002') return reply.code(409).send({ error: 'duplicate', message: 'Entry already exists for this category + text' })
      throw e
    }
  })

  app.put('/lyric-ban-entries/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = LyricBanEntryBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.lyricBanEntry.update({
        where: { id },
        data: { category: parsed.data.category, text: parsed.data.text, note: parsed.data.note ?? null },
      })
      return row
    } catch (e: any) {
      if (e?.code === 'P2025') return reply.code(404).send({ error: 'not_found' })
      if (e?.code === 'P2002') return reply.code(409).send({ error: 'duplicate', message: 'Entry already exists for this category + text' })
      throw e
    }
  })

  app.delete('/lyric-ban-entries/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await prisma.lyricBanEntry.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ----- Brand: Stores / ICPs / ReferenceTracks / Decompositions -----

  // ----- Clients (Card 3 Duke) -----

  app.get('/clients', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.client.findMany({
      orderBy: { companyName: 'asc' },
      include: {
        _count: { select: { stores: true, icps: true, memberships: true } },
        // Owner email surfaces in DASH so PLG signups are identifiable when
        // companyName is just an email-prefix slug (e.g. "danielchristopherfox").
        memberships: {
          where: { role: 'owner' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { account: { select: { email: true } } },
        },
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
      // PLG = self-serve customer with at least one membership.
      // isSystem = the one Free-Tier sentinel Client that holds the canonical
      // Free Tier ICP; it has no owner by design and is the only zero-membership
      // Client in the system. (Customer Clients without owners can be attached
      // via POST /admin/clients/:id/owner.)
      isPlg: c._count.memberships > 0,
      isSystem: c.id === FREE_TIER_CLIENT_ID,
      ownerEmail: c.memberships[0]?.account.email ?? null,
    }))
  })

  app.get('/clients/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        stores: {
          where: { archivedAt: null },
          orderBy: { name: 'asc' },
          include: {
            icpLinks: {
              where: { icp: { archivedAt: null } },
              select: { icp: { select: { id: true, name: true } } },
            },
            defaultOutcome: { select: { id: true, title: true, displayTitle: true, version: true } },
            subscription: { select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
          },
        },
        icps: {
          where: { archivedAt: null },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            _count: { select: { hooks: true, referenceTracks: true, storeLinks: true } },
          },
        },
        memberships: {
          where: { role: 'owner' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { account: { select: { email: true } } },
        },
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
      isPlg: client.memberships.length > 0,
      isSystem: client.id === FREE_TIER_CLIENT_ID,
      ownerEmail: client.memberships[0]?.account.email ?? null,
      stores: client.stores.map((s) => ({
        id: s.id,
        name: s.name,
        timezone: s.timezone,
        goLiveDate: s.goLiveDate ? s.goLiveDate.toISOString().slice(0, 10) : null,
        icps: s.icpLinks.map((l) => ({ id: l.icp.id, name: l.icp.name })),
        defaultOutcome: s.defaultOutcome,
        // Real per-store billing state — Stripe-authoritative for paidTier,
        // effective for entitlement decisions.
        tier: effectiveTier(s),
        paidTier: s.tier,
        compTier: compIsActive(s) ? s.compTier : null,
        compExpiresAt: compIsActive(s) ? s.compExpiresAt?.toISOString() ?? null : null,
        pausedUntil: s.pausedUntil?.toISOString() ?? null,
        subscription: s.subscription
          ? {
              status: s.subscription.status,
              currentPeriodEnd: s.subscription.currentPeriodEnd.toISOString(),
              cancelAtPeriodEnd: s.subscription.cancelAtPeriodEnd,
            }
          : null,
      })),
      icps: client.icps.map((i) => ({
        id: i.id, name: i.name,
        hookCount: i._count.hooks,
        referenceTrackCount: i._count.referenceTracks,
        storeCount: i._count.storeLinks,
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

  // POST /admin/clients/:id/owner — attach an Account to a Client as owner.
  //
  // Closes the "operator-managed Client" gap: a Client with zero memberships
  // is unreachable from self-serve sign-in (ensureFreeClientForUser auto-
  // provisions a fresh free-tier Client for every account that has no
  // membership yet). To merge a legacy operator-managed Client into the PLG
  // shape we have to attach an owner explicitly — that's this endpoint.
  //
  // Behavior:
  //   - Body: { email } — case-insensitive (Account.email is CITEXT).
  //   - Finds-or-creates the Account by normalized email. New Accounts have
  //     no passwordHash / no googleSub — first magic-link sign-in attaches
  //     auth.
  //   - Idempotent: if a ClientMembership already exists for this
  //     (clientId, accountId), returns it with `created: false`.
  //   - Refuses (409) if the Account already has a membership for any OTHER
  //     Client — we don't silently entangle accounts. Admin must clear the
  //     existing membership first.
  //   - Returns the membership + the (possibly new) Account.
  const OwnerAttachBody = z.object({ email: z.string().email() })

  app.post('/clients/:id/owner', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = OwnerAttachBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })

    const client = await prisma.client.findUnique({ where: { id }, select: { id: true, companyName: true } })
    if (!client) return reply.code(404).send({ error: 'client_not_found' })

    const normalizedEmail = parsed.data.email.trim().toLowerCase()

    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.account.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, name: true, isAdmin: true, disabledAt: true, memberships: { select: { clientId: true, role: true } } },
      })
      let accountCreated = false
      if (!account) {
        const created = await tx.account.create({
          data: { email: normalizedEmail },
          select: { id: true, email: true, name: true, isAdmin: true, disabledAt: true },
        })
        account = { ...created, memberships: [] }
        accountCreated = true
      }
      if (account.disabledAt) {
        return { kind: 'account_disabled' as const }
      }

      const sameClient = account.memberships.find((m) => m.clientId === id)
      if (sameClient) {
        return { kind: 'idempotent' as const, account, role: sameClient.role, accountCreated }
      }

      const otherClient = account.memberships.find((m) => m.clientId !== id)
      if (otherClient) {
        return { kind: 'already_attached_elsewhere' as const, account, otherClientId: otherClient.clientId, accountCreated }
      }

      const membership = await tx.clientMembership.create({
        data: { clientId: id, accountId: account.id, role: 'owner' },
        select: { id: true, role: true, createdAt: true },
      })
      return { kind: 'created' as const, account, membership, accountCreated }
    })

    if (result.kind === 'account_disabled') {
      return reply.code(409).send({ error: 'account_disabled' })
    }
    if (result.kind === 'already_attached_elsewhere') {
      return reply.code(409).send({
        error: 'account_already_attached',
        otherClientId: result.otherClientId,
        message: 'Account is already a member of a different Client. Clear that membership first.',
      })
    }
    if (result.kind === 'idempotent') {
      return reply.send({
        ok: true,
        created: false,
        accountCreated: result.accountCreated,
        client: { id: client.id, companyName: client.companyName },
        account: { id: result.account.id, email: result.account.email, name: result.account.name, isAdmin: result.account.isAdmin },
        role: result.role,
      })
    }
    return reply.code(201).send({
      ok: true,
      created: true,
      accountCreated: result.accountCreated,
      client: { id: client.id, companyName: client.companyName },
      account: { id: result.account.id, email: result.account.email, name: result.account.name, isAdmin: result.account.isAdmin },
      role: result.membership.role,
      membershipId: result.membership.id,
    })
  })

  // DELETE /admin/clients/:id — cascading hard-delete in a single transaction.
  //
  // The schema has Cascade on most child relations but a handful of FKs default
  // to NoAction (Store→Client, ICP→Client, POSPullRun→Client, plus several
  // Store-children: PlaybackEvent, POSEvent, POSPullRun, RetailNext*). We
  // delete those explicitly in dependency order, then let the cascading FKs
  // unwind the rest. Songs in Cloudflare R2 are NOT removed — they're shared
  // assets across Clients and orphan-cleanup is out of scope here.
  app.delete('/clients/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string

    const client = await prisma.client.findUnique({
      where: { id },
      select: { id: true, companyName: true, stores: { select: { id: true } } },
    })
    if (!client) return reply.code(404).send({ error: 'not_found' })

    const storeIds = client.stores.map((s) => s.id)

    const counts = await prisma.$transaction(async (tx) => {
      // Store-scoped non-cascade tables — must go first.
      const playbackEvents = storeIds.length
        ? await tx.playbackEvent.deleteMany({ where: { storeId: { in: storeIds } } })
        : { count: 0 }
      const posEvents = storeIds.length
        ? await tx.pOSEvent.deleteMany({ where: { storeId: { in: storeIds } } })
        : { count: 0 }
      const posPullRunsByStore = storeIds.length
        ? await tx.pOSPullRun.deleteMany({ where: { storeId: { in: storeIds } } })
        : { count: 0 }
      const retailHourly = storeIds.length
        ? await tx.retailNextHourlySnapshot.deleteMany({ where: { storeId: { in: storeIds } } })
        : { count: 0 }
      const retailDaily = storeIds.length
        ? await tx.retailNextDailySnapshot.deleteMany({ where: { storeId: { in: storeIds } } })
        : { count: 0 }
      const retailRuns = storeIds.length
        ? await tx.retailNextIngestRun.deleteMany({ where: { storeId: { in: storeIds } } })
        : { count: 0 }

      // Stores — Campaign, AdAsset, CampaignPlayState, CampaignAssetState,
      // ScheduleSlot, StoreICP, StoreAssignment, TierChangeLog all cascade.
      const stores = await tx.store.deleteMany({ where: { clientId: id } })

      // ICPs — LineageRow, Hook, ReferenceTrack, OutcomeLyricFactor, SongSeed,
      // HookWriterPrompt all cascade. Songs themselves stay (shared assets).
      const icps = await tx.iCP.deleteMany({ where: { clientId: id } })

      // Defensive: any POSPullRuns left dangling on the client_id (shouldn't
      // happen since they share storeId, but covers the edge case).
      const posPullRunsByClient = await tx.pOSPullRun.deleteMany({ where: { clientId: id } })

      // ClientMembership cascades from Client.
      await tx.client.delete({ where: { id } })

      return {
        playbackEvents: playbackEvents.count,
        posEvents: posEvents.count,
        posPullRuns: posPullRunsByStore.count + posPullRunsByClient.count,
        retailNextSnapshots: retailHourly.count + retailDaily.count,
        retailNextRuns: retailRuns.count,
        stores: stores.count,
        icps: icps.count,
      }
    })

    return reply.send({ ok: true, deleted: { client: client.companyName, ...counts } })
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
      const slug = await uniqueStoreSlug(parsed.data.name)
      // Fall back to the system default if no defaultOutcomeId was supplied,
      // so admin-created Stores are launchable without an extra setup step.
      const fallbackOutcomeId = parsed.data.defaultOutcomeId ?? await pickSystemDefaultOutcomeId()
      const row = await prisma.store.create({
        data: {
          clientId: parsed.data.clientId,
          name: parsed.data.name,
          timezone: parsed.data.timezone,
          goLiveDate: parsed.data.goLiveDate ? new Date(parsed.data.goLiveDate) : null,
          defaultOutcomeId: fallbackOutcomeId,
          slug,
          // tier defaults to 'free' at the DB layer; admin-created Stores
          // start on the PLG default and are upgraded manually as needed.
        },
        include: {
          client: { select: { companyName: true } },
          icpLinks: { select: { icp: { select: { id: true, name: true } } } },
        },
      })
      return {
        id: row.id, name: row.name, timezone: row.timezone,
        clientId: row.clientId, clientName: row.client.companyName,
        icps: row.icpLinks.map((l) => ({ id: l.icp.id, name: l.icp.name })),
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
    roomLoudnessSamplingEnabled: z.boolean().optional(),
    // Toggle the Free Tier ICP link on/off. Free stores can't toggle this off
    // (they have no other pool). Hendrix reads the StoreICP join at runtime;
    // adding/removing the row is the only thing this flag does.
    includeFreeTierPool: z.boolean().optional(),
  })

  app.put('/stores/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = StoreUpdateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const { includeFreeTierPool, ...rest } = parsed.data
    const data: any = { ...rest }
    if (parsed.data.goLiveDate !== undefined) {
      data.goLiveDate = parsed.data.goLiveDate ? new Date(parsed.data.goLiveDate) : null
    }
    // Free-tier guard: a free-tier Store's default outcome must be in the
    // FreeTierOutcome allowlist. Block other picks defensively in case the
    // client surface is bypassed.
    if (parsed.data.defaultOutcomeId !== undefined && parsed.data.defaultOutcomeId !== null) {
      const target = await prisma.store.findUnique({ where: { id }, select: { tier: true } })
      if (target?.tier === 'free') {
        const outcome = await prisma.outcome.findUnique({
          where: { id: parsed.data.defaultOutcomeId },
          select: { outcomeKey: true },
        })
        const allowed = outcome
          ? await prisma.freeTierOutcome.findUnique({ where: { outcomeKey: outcome.outcomeKey } })
          : null
        if (!allowed) {
          return reply.code(409).send({
            error: 'outcome_not_in_free_tier_allowlist',
            message: 'This outcome is not available on the free tier.',
          })
        }
      }
    }
    // Free-pool toggle. Free stores can't sever — that's their only pool.
    if (includeFreeTierPool !== undefined) {
      const target = await prisma.store.findUnique({ where: { id }, select: { tier: true } })
      if (!target) return reply.code(404).send({ error: 'not_found' })
      if (target.tier === 'free' && includeFreeTierPool === false) {
        return reply.code(409).send({
          error: 'free_tier_cannot_sever_free_pool',
          message: 'Free-tier stores draw exclusively from the free pool — cannot disable.',
        })
      }
      if (includeFreeTierPool) {
        await prisma.storeICP.upsert({
          where: { storeId_icpId: { storeId: id, icpId: FREE_TIER_ICP_ID } },
          create: { storeId: id, icpId: FREE_TIER_ICP_ID },
          update: {},
        })
      } else {
        await prisma.storeICP.deleteMany({
          where: { storeId: id, icpId: FREE_TIER_ICP_ID },
        })
      }
    }
    try {
      const row = await prisma.store.update({
        where: { id }, data,
        include: {
          client: { select: { companyName: true } },
          icpLinks: { select: { icp: { select: { id: true, name: true } } } },
        },
      })
      return {
        id: row.id, name: row.name, timezone: row.timezone,
        clientId: row.clientId, clientName: row.client.companyName,
        icps: row.icpLinks.map((l) => ({ id: l.icp.id, name: l.icp.name })),
        goLiveDate: row.goLiveDate ? row.goLiveDate.toISOString().slice(0, 10) : null,
        defaultOutcomeId: row.defaultOutcomeId,
        roomLoudnessSamplingEnabled: row.roomLoudnessSamplingEnabled,
        includeFreeTierPool: row.icpLinks.some((l) => l.icp.id === FREE_TIER_ICP_ID),
      }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete('/stores/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string

    if (id === FREE_TIER_AD_STORE_ID) {
      return reply.code(403).send({ error: 'cannot_delete_sentinel_store' })
    }

    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!store) return reply.code(404).send({ error: 'not_found' })

    const counts = await prisma.$transaction(async (tx) => {
      // Store-scoped non-cascade tables — must go first (RESTRICT default).
      const playbackEvents = await tx.playbackEvent.deleteMany({ where: { storeId: id } })
      const posEvents = await tx.pOSEvent.deleteMany({ where: { storeId: id } })
      const posPullRuns = await tx.pOSPullRun.deleteMany({ where: { storeId: id } })
      const retailHourly = await tx.retailNextHourlySnapshot.deleteMany({ where: { storeId: id } })
      const retailDaily = await tx.retailNextDailySnapshot.deleteMany({ where: { storeId: id } })
      const retailRuns = await tx.retailNextIngestRun.deleteMany({ where: { storeId: id } })

      // Store delete cascades: StoreICP, StoreAssignment, StoreRetiredSong,
      // ScheduleSlot, Campaign (→ AdAsset), CampaignPlayState, Subscription,
      // PlayerBinding, TierChangeLog.
      await tx.store.delete({ where: { id } })

      return {
        playbackEvents: playbackEvents.count,
        posEvents: posEvents.count,
        posPullRuns: posPullRuns.count,
        retailNextSnapshots: retailHourly.count + retailDaily.count,
        retailNextRuns: retailRuns.count,
      }
    })

    return reply.send({ ok: true, deleted: { store: store.name, ...counts } })
  })

  app.get('/stores', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.store.findMany({
      where: { archivedAt: null },
      orderBy: [{ client: { companyName: 'asc' } }, { name: 'asc' }],
      include: {
        client: { select: { companyName: true } },
        icpLinks: {
          where: { icp: { archivedAt: null } },
          select: { icp: { select: { id: true, name: true } } },
        },
      },
    })
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      timezone: s.timezone,
      clientId: s.clientId,
      clientName: s.client.companyName,
      icps: s.icpLinks.map((l) => ({ id: l.icp.id, name: l.icp.name })),
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
      where: { storeLinks: { some: { storeId: id } } },
      include: {
        referenceTracks: {
          orderBy: [{ bucket: 'asc' }, { status: 'desc' }, { artist: 'asc' }, { title: 'asc' }],
          include: { styleAnalysis: true },
        },
      },
    })
    const includeFreeTierPool = icps.some((i) => i.id === FREE_TIER_ICP_ID)
    return {
      store: {
        id: store.id,
        name: store.name,
        timezone: store.timezone,
        clientId: store.client.id,
        clientName: store.client.companyName,
        goLiveDate: store.goLiveDate ? store.goLiveDate.toISOString().slice(0, 10) : null,
        defaultOutcomeId: store.defaultOutcomeId,
        roomLoudnessSamplingEnabled: store.roomLoudnessSamplingEnabled,
        tier: store.tier,
        // Whether this Store also draws from the Entuned-curated free pool.
        // Default for paid stores is `false` (severed on upgrade); operators
        // can re-enable via PUT /stores/:id { includeFreeTierPool: true } if
        // a client wants the extra pool.
        includeFreeTierPool,
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
        data: {
          clientId: store.clientId,
          name: parsed.data.name,
          storeLinks: { create: { storeId: parsed.data.storeId } },
        },
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
        data: { status: 'approved', approvedAt: new Date(), approvedById: op.accountId },
      })
      // Fire-and-forget: auto-decompose on approval
      decompose({
        artist: row.artist,
        title: row.title,
        year: row.year ?? undefined,
        operatorNotes: row.operatorNotes ?? undefined,
      }).then(async (result) => {
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
          arrangementShape: result.output.arrangement_shape ?? null,
          dynamicCurve: result.output.dynamic_curve ?? null,
          vocalCharacter: result.output.vocal_character,
          vocalArrangement: result.output.vocal_arrangement,
          harmonicAndGroove: result.output.harmonic_and_groove,
          arrangementSections: result.output.arrangement_sections ?? Prisma.JsonNull,
          arrangementVersion: result.output.arrangement_sections ? result.rulesVersion : null,
          bpm: result.output.bpm ?? null,
        }
        await prisma.styleAnalysis.upsert({
          where: { referenceTrackId: id },
          create: { referenceTrackId: id, ...data },
          update: data,
        })
      }).catch((e) => {
        console.error(`[auto-decompose] failed for ${row.artist} — ${row.title}:`, e.message)
      })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.post('/reference-tracks/:id/archive', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      const row = await prisma.referenceTrack.update({
        where: { id },
        data: { status: 'archived' },
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
    const targets = await prisma.referenceTrack.findMany({ where, select: { id: true, artist: true, title: true, year: true, operatorNotes: true } })
    if (targets.length === 0) return { approvedCount: 0, ids: [] as string[] }
    const ids = targets.map((t) => t.id)
    await prisma.referenceTrack.updateMany({
      where: { id: { in: ids } },
      data: { status: 'approved', approvedAt: new Date(), approvedById: op.accountId },
    })
    // Fire-and-forget: auto-decompose all approved tracks
    for (const ref of targets) {
      decompose({
        artist: ref.artist,
        title: ref.title,
        year: ref.year ?? undefined,
        operatorNotes: ref.operatorNotes ?? undefined,
      }).then(async (result) => {
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
          arrangementShape: result.output.arrangement_shape ?? null,
          dynamicCurve: result.output.dynamic_curve ?? null,
          vocalCharacter: result.output.vocal_character,
          vocalArrangement: result.output.vocal_arrangement,
          harmonicAndGroove: result.output.harmonic_and_groove,
          arrangementSections: result.output.arrangement_sections ?? Prisma.JsonNull,
          arrangementVersion: result.output.arrangement_sections ? result.rulesVersion : null,
          bpm: result.output.bpm ?? null,
        }
        await prisma.styleAnalysis.upsert({
          where: { referenceTrackId: ref.id },
          create: { referenceTrackId: ref.id, ...data },
          update: data,
        })
      }).catch((e) => {
        console.error(`[auto-decompose] failed for ${ref.artist} — ${ref.title}:`, e.message)
      })
    }
    return { approvedCount: ids.length, ids }
  })

  // --- Decompose now: runs Claude with web search; upserts StyleAnalysis row. ---
  // Always overwrites any existing analysis. Pending suggestions cannot be
  // decomposed — approve first.
  app.post('/reference-tracks/:id/decompose', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const ref = await prisma.referenceTrack.findUnique({
      where: { id },
    })
    if (!ref) return reply.code(404).send({ error: 'not_found' })
    if (ref.status === 'pending') {
      return reply.code(409).send({ error: 'pending_reference_track', message: 'Approve the suggestion before decomposing.' })
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
      bpm: result.output.bpm ?? null,
    }
    const row = await prisma.styleAnalysis.upsert({
      where: { referenceTrackId: id },
      create: { referenceTrackId: id, ...data },
      update: data,
    })
    return row
  })

  const DecompositionUpdateBody = z.object({
    vibePitch: z.string().nullable().optional(),
    eraProductionSignature: z.string().nullable().optional(),
    instrumentationPalette: z.string().nullable().optional(),
    standoutElement: z.string().nullable().optional(),
    arrangementShape: z.string().nullable().optional(),
    dynamicCurve: z.string().nullable().optional(),
    vocalCharacter: z.string().nullable().optional(),
    vocalArrangement: z.string().nullable().optional(),
    harmonicAndGroove: z.string().nullable().optional(),
    // Private picker-compatibility data — operator can override the
    // decomposer's web-search-derived value. Never rendered into Suno.
    bpm: z.number().int().min(1).max(300).nullable().optional(),
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
          bpm: result.output.bpm ?? null,
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

  // ----- Cheap BPM backfill ---------------------------------------------------
  // Fills StyleAnalysis.bpm on existing decompositions without re-running the
  // full rules-v10 decomposer (Sonnet + 4000 max_tokens). Uses a Haiku side
  // route with one web_search call — ~$0.005-0.01 per track.
  //
  // Iterates StyleAnalysis rows where bpm IS NULL (oldest first), one at a
  // time. Returns counts + per-row outcomes. Bound by `limit` (default 50,
  // max 500) so a single call is cheap and resumable.
  const BackfillBpmBody = z.object({
    limit: z.number().int().min(1).max(500).optional(),
  })

  app.post('/style-analyses/backfill-bpm', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = BackfillBpmBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const limit = parsed.data.limit ?? 50

    const rows = await prisma.styleAnalysis.findMany({
      where: { bpm: null },
      include: { referenceTrack: { select: { id: true, artist: true, title: true, year: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    if (rows.length === 0) return { total: 0, succeeded: 0, skipped: 0, failed: 0, remaining: 0, results: [] }

    let succeeded = 0
    let skipped = 0
    let failed = 0
    const results: { styleAnalysisId: string; artist: string; title: string; bpm: number | null; confidence: 'low' | 'medium' | 'high' | null; error?: string }[] = []

    for (const row of rows) {
      const ref = row.referenceTrack
      try {
        const result = await lookupBpm({ artist: ref.artist, title: ref.title, year: ref.year })
        if (result.bpm === null) {
          skipped++
          results.push({ styleAnalysisId: row.id, artist: ref.artist, title: ref.title, bpm: null, confidence: result.confidence })
          continue
        }
        await prisma.styleAnalysis.update({ where: { id: row.id }, data: { bpm: result.bpm } })
        succeeded++
        results.push({ styleAnalysisId: row.id, artist: ref.artist, title: ref.title, bpm: result.bpm, confidence: result.confidence })
      } catch (e: any) {
        failed++
        results.push({ styleAnalysisId: row.id, artist: ref.artist, title: ref.title, bpm: null, confidence: null, error: e?.message ?? 'unknown' })
      }
    }

    const remaining = await prisma.styleAnalysis.count({ where: { bpm: null } })
    return { total: rows.length, succeeded, skipped, failed, remaining, results }
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
        createdById: op.accountId,
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
            createdById: op.accountId,
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
      hookPrompt: factorByKey.get(o.outcomeKey)?.hookPrompt ?? null,
      notes: factorByKey.get(o.outcomeKey)?.notes ?? null,
      updatedAt: factorByKey.get(o.outcomeKey)?.updatedAt?.toISOString() ?? null,
    }))
  })

  const OutcomeLyricFactorBody = z.object({
    templateText: z.string().optional(),
    hookPrompt: z.string().nullable().optional(),
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
    const updateData: Record<string, unknown> = { updatedById: op.accountId }
    if (parsed.data.templateText !== undefined) updateData.templateText = parsed.data.templateText
    if (parsed.data.hookPrompt !== undefined) updateData.hookPrompt = parsed.data.hookPrompt
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes ?? null
    const row = await prisma.outcomeLyricFactor.upsert({
      where: { outcomeKey },
      update: updateData,
      create: { outcomeKey, templateText: parsed.data.templateText ?? '', hookPrompt: parsed.data.hookPrompt ?? null, notes: parsed.data.notes ?? null, updatedById: op.accountId },
    })
    return {
      outcomeKey: row.outcomeKey,
      templateText: row.templateText,
      hookPrompt: row.hookPrompt,
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

  // ----- FormArchetype (operator-editable song-form catalogue for Bernie) -----
  // Eno picks one per generation; Bernie writes lyrics into whatever shape it
  // declares. outcomeWeights are keyed on outcome_key (stable cross-version
  // identity) plus the "*" default. eraWeights gates by reference-track year.

  const FormArchetypeBody = z.object({
    slug: z.string().min(1).max(40),
    displayName: z.string().min(1),
    sectionList: z.string().min(1),
    shapeNote: z.string().min(1),
    requiresSections: z.array(z.string()).default([]),
    outcomeWeights: z.record(z.string(), z.number().nonnegative()),
    eraWeights: z.object({
      ranges: z.array(z.object({
        minYear: z.number().int().nullable().optional(),
        maxYear: z.number().int().nullable().optional(),
        weight: z.number().nonnegative(),
      })),
    }).nullable().optional(),
    isActive: z.boolean().default(true),
    notes: z.string().nullable().optional(),
  })

  app.get('/form-archetypes', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    // Return archetypes plus the active outcome list so the editor can render
    // a human-readable per-outcome weight grid (outcomeKey JSON keys → titles).
    const [archetypes, outcomes] = await Promise.all([
      prisma.formArchetype.findMany({ orderBy: [{ isActive: 'desc' }, { slug: 'asc' }] }),
      prisma.outcome.findMany({
        where: { supersededAt: null },
        select: { outcomeKey: true, title: true, displayTitle: true },
        orderBy: [{ title: 'asc' }],
      }),
    ])
    return {
      archetypes: archetypes.map((a) => ({
        id: a.id,
        slug: a.slug,
        displayName: a.displayName,
        sectionList: a.sectionList,
        shapeNote: a.shapeNote,
        requiresSections: a.requiresSections,
        outcomeWeights: a.outcomeWeights,
        eraWeights: a.eraWeights,
        isActive: a.isActive,
        notes: a.notes,
        updatedAt: a.updatedAt.toISOString(),
      })),
      outcomes: outcomes.map((o) => ({
        outcomeKey: o.outcomeKey,
        title: o.displayTitle ?? o.title,
      })),
    }
  })

  app.post('/form-archetypes', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = FormArchetypeBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.formArchetype.create({
        data: {
          slug: parsed.data.slug,
          displayName: parsed.data.displayName,
          sectionList: parsed.data.sectionList,
          shapeNote: parsed.data.shapeNote,
          requiresSections: parsed.data.requiresSections,
          outcomeWeights: parsed.data.outcomeWeights,
          eraWeights: parsed.data.eraWeights ?? Prisma.JsonNull,
          isActive: parsed.data.isActive,
          notes: parsed.data.notes ?? null,
        },
      })
      return row
    } catch (e: any) {
      if (e?.code === 'P2002') return reply.code(409).send({ error: 'slug_taken' })
      throw e
    }
  })

  app.put('/form-archetypes/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = FormArchetypeBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    try {
      const row = await prisma.formArchetype.update({
        where: { id },
        data: {
          slug: parsed.data.slug,
          displayName: parsed.data.displayName,
          sectionList: parsed.data.sectionList,
          shapeNote: parsed.data.shapeNote,
          requiresSections: parsed.data.requiresSections,
          outcomeWeights: parsed.data.outcomeWeights,
          eraWeights: parsed.data.eraWeights ?? Prisma.JsonNull,
          isActive: parsed.data.isActive,
          notes: parsed.data.notes ?? null,
        },
      })
      return row
    } catch (e: any) {
      if (e?.code === 'P2025') return reply.code(404).send({ error: 'not_found' })
      if (e?.code === 'P2002') return reply.code(409).send({ error: 'slug_taken' })
      throw e
    }
  })

  app.delete('/form-archetypes/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      await prisma.formArchetype.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ----- Free Tier Outcome Allowlist -----
  // Operator-curated set of outcomeKeys available to free-tier stores. Player
  // greys out + locks any outcome whose key is NOT in this set when the viewer
  // is on free tier. Toggle in Dash to gate, or unlock for a promo week.

  app.get('/free-tier-outcomes', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    // Return one row per outcomeKey (latest active version's metadata) plus
    // an `availableOnFree` flag from free_tier_outcomes. Superseded versions
    // are folded into their active sibling.
    const [outcomes, allowed] = await Promise.all([
      prisma.outcome.findMany({
        where: { supersededAt: null },
        select: { id: true, outcomeKey: true, title: true, displayTitle: true, version: true },
        orderBy: [{ title: 'asc' }],
      }),
      prisma.freeTierOutcome.findMany({ select: { outcomeKey: true } }),
    ])
    const allowedSet = new Set(allowed.map((a) => a.outcomeKey))
    return outcomes.map((o) => ({
      outcomeKey: o.outcomeKey,
      outcomeId: o.id,
      title: o.displayTitle ?? o.title,
      version: o.version,
      availableOnFree: allowedSet.has(o.outcomeKey),
    }))
  })

  const FreeTierOutcomeToggleBody = z.object({ outcomeKey: z.string().uuid() })
  app.post('/free-tier-outcomes/toggle', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = FreeTierOutcomeToggleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const { outcomeKey } = parsed.data
    const existing = await prisma.freeTierOutcome.findUnique({ where: { outcomeKey } })
    if (existing) {
      await prisma.freeTierOutcome.delete({ where: { outcomeKey } })
      return { availableOnFree: false }
    }
    await prisma.freeTierOutcome.create({ data: { outcomeKey } })
    return { availableOnFree: true }
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
          client: { select: { id: true, companyName: true } },
          storeLinks: { select: { store: { select: { id: true, name: true } } } },
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
        stores: icp.storeLinks.map((l) => l.store),
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

    // free-tier filter: 'hide' (default — non-Free-Tier rows only), 'only'
    // (Free Tier ICP rows only), 'all' (both). Replaces the legacy general-pool
    // filter — "general pool" is now formally the Free Tier ICP.
    const general = q.general ?? 'hide'
    if (general === 'hide') where.icpId = { not: FREE_TIER_ICP_ID }
    else if (general === 'only') where.icpId = FREE_TIER_ICP_ID
    // 'all' → no filter

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

    // Resolve ICP names + client + first linked store in one shot.
    const icpIds = [...new Set(rows.map((r) => r.icpId))]
    const icps = icpIds.length === 0 ? [] : await prisma.iCP.findMany({
      where: { id: { in: icpIds } },
      select: {
        id: true, name: true,
        client: { select: { id: true, companyName: true } },
        storeLinks: { take: 1, select: { store: { select: { id: true, name: true } } } },
      },
    })
    const icpById = new Map(icps.map((i) => [i.id, i]))

    // Compute inGeneralPool per row by looking up sibling Free Tier ICP rows
    // (same songId+outcomeId, icpId=FREE_TIER_ICP_ID, active). One query for all rows.
    const generalSiblings = rows.length === 0 ? [] : await prisma.lineageRow.findMany({
      where: {
        icpId: FREE_TIER_ICP_ID,
        active: true,
        OR: rows.map((r) => ({ songId: r.songId, outcomeId: r.outcomeId })),
      },
      select: { songId: true, outcomeId: true },
    })
    const generalKeys = new Set(generalSiblings.map((g) => `${g.songId}::${g.outcomeId}`))

    // Aggregate love + report counts per song across all stores (one groupBy).
    const pageSongIds = [...new Set(rows.map((r) => r.songId))]
    const reactionCounts = pageSongIds.length === 0 ? [] : await prisma.playbackEvent.groupBy({
      by: ['songId', 'eventType'],
      where: { songId: { in: pageSongIds }, eventType: { in: ['song_love', 'song_report'] } },
      _count: { _all: true },
    })
    const loveBySong = new Map<string, number>()
    const reportBySong = new Map<string, number>()
    for (const c of reactionCounts) {
      if (!c.songId) continue
      const n = c._count._all
      if (c.eventType === 'song_love') loveBySong.set(c.songId, n)
      else if (c.eventType === 'song_report') reportBySong.set(c.songId, n)
    }

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
          storeName: i?.storeLinks[0]?.store.name ?? null,
          outcome: r.outcome,
          hook: r.hook,
          song: r.song,
          songTitle: r.songSeed?.title ?? null,
          // True if this song+outcome has a Free Tier ICP row (whether via a
          // sibling row or via this row itself if icpId IS the Free Tier ICP).
          inGeneralPool: r.icpId === FREE_TIER_ICP_ID || generalKeys.has(`${r.songId}::${r.outcomeId}`),
          loveCount: loveBySong.get(r.songId) ?? 0,
          reportCount: reportBySong.get(r.songId) ?? 0,
        }
      }),
    }
  })

  // POST /admin/lineage-rows/:id/toggle-general
  // Toggles whether the song this row references is in the Free Tier ICP
  // catalogue. For any source row (paid-ICP or Free Tier):
  //   - If a Free Tier row exists for (songId, outcomeId), DELETE it.
  //   - Else INSERT a new Free Tier row (icpId=FREE_TIER_ICP_ID, hookId=NULL).
  // The source row itself is never modified.
  app.post('/lineage-rows/:id/toggle-general', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const source = await prisma.lineageRow.findUnique({
      where: { id },
      select: { songId: true, outcomeId: true, r2Url: true, songSeedId: true },
    })
    if (!source) return reply.code(404).send({ error: 'not_found' })

    const existing = await prisma.lineageRow.findFirst({
      where: { songId: source.songId, outcomeId: source.outcomeId, icpId: FREE_TIER_ICP_ID, active: true },
      select: { id: true },
    })

    if (existing) {
      await prisma.lineageRow.delete({ where: { id: existing.id } })
      return { inGeneralPool: false }
    }

    await prisma.lineageRow.create({
      data: {
        songId: source.songId,
        r2Url: source.r2Url,
        outcomeId: source.outcomeId,
        icpId: FREE_TIER_ICP_ID,
        hookId: null,
        songSeedId: source.songSeedId,
        active: true,
      },
    })
    return { inGeneralPool: true }
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
    const allReportingStoreIds = new Set<string>()
    for (const b of bySong.values()) for (const sid of b.storeIds) allReportingStoreIds.add(sid)
    const [lineageRows, songs, stores, retiredRows] = await Promise.all([
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
      prisma.store.findMany({
        where: { id: { in: [...allReportingStoreIds] } },
        select: { id: true, name: true, client: { select: { id: true, companyName: true } } },
      }),
      prisma.storeRetiredSong.findMany({
        where: { songId: { in: songIds }, storeId: { in: [...allReportingStoreIds] } },
        select: { storeId: true, songId: true },
      }),
    ])
    const songById = new Map(songs.map((s) => [s.id, s]))
    const storeById = new Map(stores.map((s) => [s.id, s]))
    const retiredKey = new Set(retiredRows.map((r) => `${r.storeId}:${r.songId}`))
    const lineageBySong = new Map<string, typeof lineageRows>()
    for (const lr of lineageRows) {
      const list = lineageBySong.get(lr.songId) ?? []
      list.push(lr)
      lineageBySong.set(lr.songId, list)
    }

    // Per-(song, storeId) report counts so the panel can show "which location
    // reported, how many times" and offer a per-location retire action.
    const byPair = new Map<string, { storeId: string; songId: string; reportCount: number }>()
    for (const e of events) {
      if (!e.songId) continue
      const k = `${e.storeId}:${e.songId}`
      let p = byPair.get(k)
      if (!p) { p = { storeId: e.storeId, songId: e.songId, reportCount: 0 }; byPair.set(k, p) }
      p.reportCount++
    }
    const locationsBySong = new Map<string, { storeId: string; storeName: string; clientName: string; reportCount: number; suppressed: boolean }[]>()
    for (const p of byPair.values()) {
      const s = storeById.get(p.storeId)
      const list = locationsBySong.get(p.songId) ?? []
      list.push({
        storeId: p.storeId,
        storeName: s?.name ?? '(unknown)',
        clientName: s?.client?.companyName ?? '(unknown)',
        reportCount: p.reportCount,
        suppressed: retiredKey.has(`${p.storeId}:${p.songId}`),
      })
      locationsBySong.set(p.songId, list)
    }
    for (const list of locationsBySong.values()) list.sort((a, b) => b.reportCount - a.reportCount)

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
        locations: locationsBySong.get(b.songId) ?? [],
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

  // Per-store song suppression. Free-tier stores share one ICP, so the global
  // /retire above is too blunt. This route writes a StoreRetiredSong row that
  // hendrix.fetchPool excludes for that single location.
  const RetireForStoreBody = z.object({
    storeId: z.string().uuid(),
    reason: z.string().nullable().optional(),
  })

  app.post('/flagged/:songId/retire-for-store', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const songId = (req.params as any).songId as string
    const parsed = RetireForStoreBody.safeParse(req.body)
    if (!parsed.success) { reply.code(400); return { error: 'invalid body', issues: parsed.error.issues } }
    const { storeId, reason } = parsed.data
    await prisma.storeRetiredSong.upsert({
      where: { storeId_songId: { storeId, songId } },
      create: { storeId, songId, reason: reason ?? null },
      update: { reason: reason ?? null },
    })
    return { ok: true }
  })

  app.delete('/flagged/:songId/retire-for-store/:storeId', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const { songId, storeId } = req.params as any
    await prisma.storeRetiredSong.deleteMany({ where: { storeId, songId } })
    return { ok: true }
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
    vocalGender: z.enum(['male', 'female', 'duet']).nullable().optional(),
    approve: z.boolean().optional(),
    /** Persist as rejected with optional reason. Mutually exclusive with approve. */
    reject: z.union([z.boolean(), z.object({ reason: z.string().max(280).optional() })]).optional(),
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
        create: { icpId, promptText: parsed.data.promptText, version: nextVersion, updatedById: op.accountId },
        update: { promptText: parsed.data.promptText, version: nextVersion, updatedById: op.accountId },
      })
      await tx.hookWriterPromptVersion.create({
        data: {
          icpId, version: nextVersion,
          promptText: parsed.data.promptText,
          notes: parsed.data.notes ?? null,
          createdById: op.accountId,
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
        approvedById: parsed.data.approve ? op.accountId : null,
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
    if (parsed.data.approve && parsed.data.reject) {
      return reply.code(400).send({ error: 'approve_and_reject_are_mutually_exclusive' })
    }
    try {
      const rejectReason = parsed.data.reject && typeof parsed.data.reject === 'object'
        ? parsed.data.reject.reason?.trim() || null
        : null
      const status = parsed.data.approve ? 'approved' : parsed.data.reject ? 'rejected' : 'draft'
      const data: any = {
        icpId,
        outcomeId: parsed.data.outcomeId,
        text: parsed.data.text,
        vocalGender: parsed.data.vocalGender ?? null,
        status,
      }
      if (parsed.data.approve) {
        data.approvedAt = new Date()
        data.approvedById = op.accountId
      }
      if (parsed.data.reject) {
        data.rejectionReason = rejectReason
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
    const row = await prisma.hook.update({
      where: { id }, data: parsed.data,
      include: { outcome: { select: { id: true, title: true, displayTitle: true, version: true } } },
    })
    return row
  })

  const HookRejectBody = z.object({
    reason: z.string().max(280).optional(),
  })

  // Reject a draft hook. Persists status='rejected' and captures an optional
  // reason that feeds the next drafter batch as an anti-anchor.
  app.post('/hooks/:id/reject', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = HookRejectBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const existing = await prisma.hook.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'approved') return reply.code(409).send({ error: 'approved_hook_cannot_be_rejected' })
    if (existing.status === 'rejected') return existing
    const row = await prisma.hook.update({
      where: { id },
      data: { status: 'rejected', rejectionReason: parsed.data.reason?.trim() || null },
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
      data: { status: 'approved', approvedAt: new Date(), approvedById: op.accountId },
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
      include: {
        client: { select: { companyName: true } },
        icpLinks: { select: { icpId: true } },
      },
    })
    if (!store) return reply.code(404).send({ error: 'not_found' })
    const icpIds = store.icpLinks.map((l) => l.icpId)

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
          account: { select: { id: true, email: true } },
          song: { select: { lineageRows: { select: { songSeed: { select: { title: true } } }, take: 1 } } },
        },
      }),
    ])

    const poolByOutcome = new Map(lineageCounts.map((c) => [c.outcomeId, c._count._all]))
    const outcomeById = new Map(outcomes.map((o) => [o.id, o]))

    const queueHookIds = [...new Set(hendrix.queue.map((q) => q.hookId).filter((h): h is string => !!h))]
    const queueHooks = queueHookIds.length
      ? await prisma.hook.findMany({ where: { id: { in: queueHookIds } }, select: { id: true, text: true } })
      : []
    const hookTextById = new Map(queueHooks.map((h) => [h.id, h.text]))
    const queueWithTitles = hendrix.queue.map((q) => ({
      ...q,
      hookText: q.hookId ? (hookTextById.get(q.hookId) ?? null) : null,
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
        songTitle: e.song?.lineageRows?.[0]?.songSeed?.title ?? null,
        hookId: e.hookId,
        outcomeId: e.outcomeId,
        outcomeTitle: e.outcomeId ? (outcomeById.get(e.outcomeId)?.title ?? null) : null,
        outcomeDisplayTitle: e.outcomeId ? (outcomeById.get(e.outcomeId)?.displayTitle ?? null) : null,
        accountId: e.accountId,
        operatorEmail: e.account?.email ?? null,
        reportReason: e.reportReason,
        extra: e.extra ?? null,
        // Phase-3 correlation fields.
        playbackSessionId: e.playbackSessionId,
        deviceId: e.deviceId,
        playDurationMs: e.playDurationMs,
        completionReason: e.completionReason,
        effectiveOutcomeId: e.effectiveOutcomeId,
        clientBuild: e.clientBuild,
      })),
    }
  })

  // Paginated playback events for the Event Stream card. Cursor-based:
  // pass `before` (an ISO occurredAt) to fetch older rows. Returns
  // `nextBefore` (ISO of the last row, or null if no more data).
  app.get('/stores/:id/events', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const q = req.query as { before?: string; limit?: string }
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
    const beforeDate = q.before ? new Date(q.before) : null
    if (beforeDate && Number.isNaN(beforeDate.getTime())) {
      return reply.code(400).send({ error: 'bad_before' })
    }

    const events = await prisma.playbackEvent.findMany({
      where: {
        storeId: id,
        ...(beforeDate ? { occurredAt: { lt: beforeDate } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        account: { select: { id: true, email: true } },
        song: { select: { lineageRows: { select: { songSeed: { select: { title: true } } }, take: 1 } } },
      },
    })

    const outcomeIds = [...new Set(events.map((e) => e.outcomeId).filter((x): x is string => !!x))]
    const outcomeRows = outcomeIds.length
      ? await prisma.outcome.findMany({ where: { id: { in: outcomeIds } }, select: { id: true, title: true, displayTitle: true } })
      : []
    const outcomeById = new Map(outcomeRows.map((o) => [o.id, o]))

    return {
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        songId: e.songId,
        songTitle: e.song?.lineageRows?.[0]?.songSeed?.title ?? null,
        hookId: e.hookId,
        outcomeId: e.outcomeId,
        outcomeTitle: e.outcomeId ? (outcomeById.get(e.outcomeId)?.title ?? null) : null,
        outcomeDisplayTitle: e.outcomeId ? (outcomeById.get(e.outcomeId)?.displayTitle ?? null) : null,
        accountId: e.accountId,
        operatorEmail: e.account?.email ?? null,
        reportReason: e.reportReason,
        extra: e.extra ?? null,
        playbackSessionId: e.playbackSessionId,
        deviceId: e.deviceId,
        playDurationMs: e.playDurationMs,
        completionReason: e.completionReason,
        effectiveOutcomeId: e.effectiveOutcomeId,
        clientBuild: e.clientBuild,
      })),
      nextBefore: events.length === limit ? events[events.length - 1].occurredAt : null,
    }
  })

  // Player Health summary for a single store. Surfaces only the problem
  // events from the audio stream — stalls, starves, load failures, push
  // unsubscribes — bucketed by day with severity coding. Replaces "scan the
  // full event firehose for trouble" with a single read.
  app.get('/stores/:id/player-health', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const q = z.object({ days: z.coerce.number().int().min(1).max(60).default(7) }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'bad_query' })
    const since = new Date(Date.now() - q.data.days * 24 * 60 * 60 * 1000)

    const problemTypes = [
      'playback_starved',
      'playback_stalled',
      'song_load_failed',
      'push_unsubscribed',
      'wake_lock_failed',
      'interruption_suspected',
    ]
    const events = await prisma.playbackEvent.findMany({
      where: { storeId: id, eventType: { in: problemTypes }, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true, eventType: true, occurredAt: true, deviceId: true,
        playbackSessionId: true, clientBuild: true, extra: true, songId: true,
      },
      take: 500,
    })

    // Per-day counts per event_type for a compact sparkline-ready response.
    type DayBucket = { day: string; counts: Record<string, number> }
    const byDay = new Map<string, DayBucket>()
    for (const e of events) {
      const day = e.occurredAt.toISOString().slice(0, 10)
      let b = byDay.get(day)
      if (!b) { b = { day, counts: {} }; byDay.set(day, b) }
      b.counts[e.eventType] = (b.counts[e.eventType] ?? 0) + 1
    }

    return {
      sinceDays: q.data.days,
      totalsByType: events.reduce((acc, e) => {
        acc[e.eventType] = (acc[e.eventType] ?? 0) + 1
        return acc
      }, {} as Record<string, number>),
      daily: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)),
      recent: events.slice(0, 100).map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        deviceId: e.deviceId,
        playbackSessionId: e.playbackSessionId,
        clientBuild: e.clientBuild,
        songId: e.songId,
        extra: e.extra ?? null,
      })),
    }
  })

  const OverrideBody = z.object({ outcomeId: z.string().uuid() })

  app.post('/stores/:id/outcome-selection', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = OverrideBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const target = await prisma.store.findUnique({ where: { id }, select: { tier: true } })
    if (target?.tier === 'free' && !(await isFreeTierAllowedOutcome(parsed.data.outcomeId))) {
      return reply.code(409).send({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
    }
    try {
      const { outcomeId, expiresAt } = await setOverride(id, parsed.data.outcomeId)
      await prisma.playbackEvent.create({
        data: {
          eventType: 'outcome_selection',
          storeId: id,
          occurredAt: new Date(),
          accountId: op.accountId,
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
          accountId: op.accountId,
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

  app.post('/stores/:id/schedule', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = ScheduleSlotBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    // Free-tier guard: schedule slots may only reference outcomes in the
    // FreeTierOutcome allowlist (same rule that gates default-outcome picks).
    const target = await prisma.store.findUnique({ where: { id }, select: { tier: true } })
    if (target?.tier === 'free' && !(await isFreeTierAllowedOutcome(parsed.data.outcomeId))) {
      return reply.code(409).send({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
    }
    const existing = await prisma.scheduleSlot.findMany({ where: { storeId: id, dayOfWeek: parsed.data.dayOfWeek } })
    const clash = findOverlappingSlot(parsed.data, existing)
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
    const parsed = ScheduleSlotBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    if (hhmmToSec(parsed.data.startTime) >= hhmmToSec(parsed.data.endTime)) {
      return reply.code(400).send({ error: 'start_must_precede_end' })
    }
    const current = await prisma.scheduleSlot.findUnique({ where: { id } })
    if (!current) return reply.code(404).send({ error: 'not_found' })
    // Free-tier guard: same rule as create — outcome must be allowlisted when
    // the owning store is free tier.
    const target = await prisma.store.findUnique({ where: { id: current.storeId }, select: { tier: true } })
    if (target?.tier === 'free' && !(await isFreeTierAllowedOutcome(parsed.data.outcomeId))) {
      return reply.code(409).send({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
    }
    const siblings = await prisma.scheduleSlot.findMany({
      where: { storeId: current.storeId, dayOfWeek: parsed.data.dayOfWeek, id: { not: id } },
    })
    const clash = findOverlappingSlot(parsed.data, siblings)
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
        icpLinks: { select: { icp: { select: { id: true, name: true } } } },
        defaultOutcome: { select: { id: true, title: true, displayTitle: true, version: true, supersededAt: true } },
      },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const dryRunIcpIds = store.icpLinks.map((l) => l.icp.id)

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
      icps: store.icpLinks.map((l) => ({ id: l.icp.id, name: l.icp.name })),
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
    // ICP isn't declared as a Prisma relation on SongSeed; fetch it separately
    // so the detail surface can show name without a schema change.
    const icp = await prisma.iCP.findUnique({ where: { id: row.icpId }, select: { id: true, name: true } })
    return { ...row, icp }
  })

  const SongSeedPatchBody = z.object({
    lyrics: z.string().optional(),
    style: z.string().optional(),
    negativeStyle: z.string().optional(),
    title: z.string().optional(),
    vocalGender: z.enum(['male', 'female', 'duet', 'instrumental']).nullable().optional(),
  })

  // Edit the prompt fields on a queued song seed. Only queued seeds are editable
  // (accepted seeds are terminal). Used by the SongSeed modal's Save button and
  // the auto-save-before-accept flow.
  app.patch('/song-seeds/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = SongSeedPatchBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })

    const existing = await prisma.songSeed.findUnique({ where: { id }, select: { status: true } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'queued') {
      return reply.code(409).send({ error: 'not_queued', message: `SongSeed is ${existing.status}; only queued prompts can be edited` })
    }

    const data: any = {}
    if (parsed.data.lyrics !== undefined) data.lyrics = parsed.data.lyrics
    if (parsed.data.style !== undefined) data.style = parsed.data.style
    if (parsed.data.negativeStyle !== undefined) data.negativeStyle = parsed.data.negativeStyle
    if (parsed.data.title !== undefined) data.title = parsed.data.title
    if (parsed.data.vocalGender !== undefined) data.vocalGender = parsed.data.vocalGender

    const row = await prisma.songSeed.update({
      where: { id },
      data,
      include: {
        hook: { select: { id: true, text: true } },
        outcome: true,
        referenceTrack: { include: { styleAnalysis: true } },
        songSeedBatch: true,
        lineageRows: { include: { song: true } },
      },
    })
    const icp = await prisma.iCP.findUnique({ where: { id: row.icpId }, select: { id: true, name: true } })
    return { ...row, icp }
  })

  // Song Creation Queue dashboard: per-outcome inventory for an ICP.
  // Returns counts the operator needs to decide what to act on without trial-and-error.
  app.get('/song-creation-queue/inventory', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const icpId = (req.query as any).icpId as string | undefined
    if (!icpId) return reply.code(400).send({ error: 'missing_icpId' })

    const [outcomes, hooks, songSeeds, batchAggs, refTracksReady] = await Promise.all([
      prisma.outcome.findMany({
        where: { supersededAt: null },
        orderBy: { title: 'asc' },
        select: { id: true, outcomeKey: true, title: true, displayTitle: true, mood: true, version: true },
      }),
      prisma.hook.findMany({
        where: { icpId },
        select: {
          id: true, outcomeId: true, status: true,
          songSeeds: { select: { status: true } },
        },
      }),
      prisma.songSeed.groupBy({
        by: ['outcomeId', 'status'],
        where: { icpId },
        _count: { _all: true },
      }),
      prisma.songSeedBatch.groupBy({
        by: ['outcomeId'],
        where: { icpId },
        _max: { startedAt: true },
      }),
      prisma.referenceTrack.count({
        where: { icpId, status: 'approved', styleAnalysis: { isNot: null } },
      }),
    ])

    // Group hooks by outcomeId
    const hooksByOutcome = new Map<string, { available: number; total: number; draft: number }>()
    for (const h of hooks) {
      let entry = hooksByOutcome.get(h.outcomeId)
      if (!entry) { entry = { available: 0, total: 0, draft: 0 }; hooksByOutcome.set(h.outcomeId, entry) }
      if (h.status === 'approved') {
        entry.total++
        const blocked = h.songSeeds.some((s) => s.status === 'assembling' || s.status === 'queued' || s.status === 'accepted')
        if (!blocked) entry.available++
      } else if (h.status === 'draft') {
        entry.draft++
      }
    }

    // Group seeds by outcomeId + status
    const seedsByOutcome = new Map<string, { assembling: number; queued: number; accepted: number; failed: number }>()
    for (const row of songSeeds) {
      let entry = seedsByOutcome.get(row.outcomeId)
      if (!entry) { entry = { assembling: 0, queued: 0, accepted: 0, failed: 0 }; seedsByOutcome.set(row.outcomeId, entry) }
      const n = row._count._all
      if (row.status === 'assembling') entry.assembling += n
      else if (row.status === 'queued') entry.queued += n
      else if (row.status === 'accepted') entry.accepted += n
      else if (row.status === 'failed') entry.failed += n
    }

    const lastBatchByOutcome = new Map<string, Date | null>()
    for (const row of batchAggs) {
      lastBatchByOutcome.set(row.outcomeId, row._max.startedAt ?? null)
    }

    const rows = outcomes.map((o) => {
      const h = hooksByOutcome.get(o.id) ?? { available: 0, total: 0, draft: 0 }
      const s = seedsByOutcome.get(o.id) ?? { assembling: 0, queued: 0, accepted: 0, failed: 0 }
      const last = lastBatchByOutcome.get(o.id) ?? null
      return {
        id: o.id,
        outcomeKey: o.outcomeKey,
        title: o.title,
        displayTitle: o.displayTitle,
        mood: o.mood,
        hooksAvailable: h.available,
        hooksApproved: h.total,
        hooksDraft: h.draft,
        seedsAssembling: s.assembling,
        seedsQueued: s.queued,
        seedsAccepted: s.accepted,
        seedsFailed: s.failed,
        lastBatchAt: last ? last.toISOString() : null,
      }
    })

    return { icpId, refTracksReady, outcomes: rows }
  })

  const SeedBuilderRunBody = z.object({
    icpId: z.string().uuid(),
    outcomeId: z.string().uuid(),
    n: z.number().int().min(1).max(20),
    styleBuilder: z.enum(['router', 'legacy', 'anchor']).optional(),
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
        triggeredByUser: op.accountId,
        styleBuilder: parsed.data.styleBuilder,
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
    try {
      const row = await prisma.styleAnalysis.update({ where: { id }, data: parsed.data })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ── Operator management ──────────────────────────────────────────────────

  // GET /admin/operators — list all operators with store assignments
  app.get('/operators', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.account.findMany({
      orderBy: { email: 'asc' },
      include: { storeAssignments: { include: { store: { select: { id: true, name: true, client: { select: { companyName: true } } } } } } },
    })
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      isAdmin: r.isAdmin,
      disabledAt: r.disabledAt?.toISOString() ?? null,
      stores: r.storeAssignments.map((a) => ({ id: a.store.id, name: a.store.name, clientName: a.store.client?.companyName ?? null })),
    }))
  })

  const OperatorCreateBody = z.object({
    email: z.string().email().transform((s) => s.trim().toLowerCase()),
    password: z.string().min(1),
    name: z.string().nullable().optional(),
    storeIds: z.array(z.string().uuid()).optional(),
  })

  // POST /admin/operators — create a new operator
  app.post('/operators', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = OperatorCreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    const passwordHash = await bcrypt.hash(parsed.data.password, 10)
    try {
      const created = await prisma.account.create({
        data: {
          email: parsed.data.email,
          passwordHash,
          name: parsed.data.name ?? null,
          isAdmin: false,
          storeAssignments: parsed.data.storeIds?.length
            ? { create: parsed.data.storeIds.map((storeId) => ({ storeId, assignedById: op.accountId })) }
            : undefined,
        },
        include: { storeAssignments: { include: { store: { select: { id: true, name: true, client: { select: { companyName: true } } } } } } },
      })
      return {
        id: created.id, email: created.email, name: created.name,
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
    name: z.string().nullable().optional(),
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
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    let bumpTokenVersion = false
    if (parsed.data.password) {
      data.passwordHash = await bcrypt.hash(parsed.data.password, 10)
      data.passwordSetAt = new Date()
      bumpTokenVersion = true
    }
    if (parsed.data.disabled !== undefined) {
      data.disabledAt = parsed.data.disabled ? new Date() : null
      if (parsed.data.disabled) bumpTokenVersion = true
    }
    // Email change also revokes — sessions issued under the old email shouldn't
    // continue under the new one.
    if (parsed.data.email !== undefined) bumpTokenVersion = true
    if (bumpTokenVersion) data.tokenVersion = { increment: 1 }
    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (parsed.data.storeIds !== undefined) {
          await tx.storeAssignment.deleteMany({ where: { accountId: id } })
          if (parsed.data.storeIds.length > 0) {
            await tx.storeAssignment.createMany({
              data: parsed.data.storeIds.map((storeId) => ({ accountId: id, storeId, assignedById: op.accountId })),
            })
          }
        }
        return tx.account.update({
          where: { id },
          data,
          include: { storeAssignments: { include: { store: { select: { id: true, name: true, client: { select: { companyName: true } } } } } } },
        })
      })
      return {
        id: updated.id, email: updated.email, name: updated.name,
        isAdmin: updated.isAdmin, disabledAt: updated.disabledAt?.toISOString() ?? null,
        stores: updated.storeAssignments.map((a: { store: { id: string; name: string; client: { companyName: string } | null } }) => ({ id: a.store.id, name: a.store.name, clientName: a.store.client?.companyName ?? null })),
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return reply.code(409).send({ error: 'email_taken' })
        if (e.code === 'P2025') return reply.code(404).send({ error: 'not_found' })
      }
      throw e
    }
  })

  // ── App-user (customer) management ───────────────────────────────────────
  //
  // Distinct from /admin/operators (Dash operators). These routes are how Dash
  // helps app.entuned.co customers when they get stuck — change email, send a
  // fresh magic link, revoke sessions (post-incident), soft-disable.
  //
  // Users have no password; "reset" doesn't apply. The operator-facing
  // recovery primitive is "send magic link".

  // GET /admin/users[?q=substring][&clientId=<uuid>]
  app.get('/users', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const q = ((req.query as any)?.q as string | undefined)?.trim().toLowerCase() ?? ''
    const clientId = ((req.query as any)?.clientId as string | undefined)?.trim() || ''
    const conds: any[] = []
    if (q) {
      conds.push({
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { name: { contains: q, mode: 'insensitive' as const } },
        ],
      })
    }
    if (clientId) {
      conds.push({ memberships: { some: { clientId } } })
    }
    const where = conds.length === 0 ? {} : conds.length === 1 ? conds[0] : { AND: conds }
    const rows = await prisma.account.findMany({
      where,
      orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        memberships: {
          include: { client: { select: { id: true, companyName: true } } },
        },
      },
    })
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      googleSubLinked: !!u.googleSub,
      disabledAt: u.disabledAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lifecycleEmailsOptOut: u.lifecycleEmailsOptOut,
      tokenVersion: u.tokenVersion,
      clients: u.memberships.map((m) => ({
        id: m.client.id, companyName: m.client.companyName, role: m.role,
      })),
    }))
  })

  const UserPatchBody = z.object({
    email: z.string().email().transform((s) => s.trim().toLowerCase()).optional(),
    name: z.string().nullable().optional(),
  })

  // PATCH /admin/users/:id — email and/or name. Email change bumps tokenVersion
  // (boots the user out of any active sessions) and burns outstanding magic
  // links keyed on the old email.
  app.patch('/users/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = UserPatchBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    if (parsed.data.email === undefined && parsed.data.name === undefined) {
      return reply.code(400).send({ error: 'no_changes' })
    }
    const existing = await prisma.account.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    try {
      const data: any = {}
      if (parsed.data.name !== undefined) data.name = parsed.data.name
      const emailChanged = parsed.data.email !== undefined && parsed.data.email !== existing.email
      if (emailChanged) {
        data.email = parsed.data.email
        data.tokenVersion = { increment: 1 }
      }
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.account.update({ where: { id }, data })
        if (emailChanged) {
          // Burn any unconsumed magic-link tokens for the old OR new email.
          await tx.magicLinkToken.updateMany({
            where: {
              email: { in: [existing.email, parsed.data.email!] },
              consumedAt: null,
            },
            data: { consumedAt: new Date() },
          })
        }
        return u
      })
      return {
        ok: true,
        emailChanged,
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          tokenVersion: updated.tokenVersion,
        },
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.code(409).send({ error: 'email_taken' })
      }
      throw e
    }
  })

  // POST /admin/users/:id/send-magic-link — operator-triggered. Same surface as
  // the customer-initiated flow, just bypasses the rate-limit and goes to
  // whatever email is on the user record.
  app.post('/users/:id/send-magic-link', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const u = await prisma.account.findUnique({ where: { id } })
    if (!u) return reply.code(404).send({ error: 'not_found' })
    if (u.disabledAt) return reply.code(400).send({ error: 'account_disabled' })

    const { createHash, randomBytes } = await import('node:crypto')
    const tokenRaw = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(tokenRaw).digest('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    await prisma.magicLinkToken.create({
      data: { email: u.email, tokenHash, expiresAt },
    })

    const baseUrl = process.env.MAGIC_LINK_BASE_URL
    if (!baseUrl) return reply.code(500).send({ error: 'magic_link_base_url_not_set' })
    const link = `${baseUrl}?token=${encodeURIComponent(tokenRaw)}`
    const { sendMagicLink } = await import('../lib/email.js')
    const send = await sendMagicLink(u.email, link)
    return { ok: true, sentTo: u.email, dryRun: send.dryRun ?? false, error: send.error }
  })

  // POST /admin/users/:id/revoke-sessions — bumps tokenVersion. Any cookie
  // issued before this call stops resolving. Use after a credential leak,
  // device theft, or just to log a customer out.
  app.post('/users/:id/revoke-sessions', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    try {
      const u = await prisma.account.update({
        where: { id },
        data: { tokenVersion: { increment: 1 } },
      })
      return { ok: true, tokenVersion: u.tokenVersion }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return reply.code(404).send({ error: 'not_found' })
      }
      throw e
    }
  })

  const UserDisableBody = z.object({ disabled: z.boolean() })

  // POST /admin/users/:id/disable { disabled: true|false } — soft-disable.
  // Disabling also bumps tokenVersion so any active session is killed
  // immediately. Re-enabling does not bump.
  app.post('/users/:id/disable', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as any).id as string
    const parsed = UserDisableBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    try {
      const data: any = parsed.data.disabled
        ? { disabledAt: new Date(), tokenVersion: { increment: 1 } }
        : { disabledAt: null }
      const u = await prisma.account.update({ where: { id }, data })
      return { ok: true, disabledAt: u.disabledAt?.toISOString() ?? null, tokenVersion: u.tokenVersion }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return reply.code(404).send({ error: 'not_found' })
      }
      throw e
    }
  })

  // ── Per-Client unified logins ────────────────────────────────────────────
  //
  // Returns every Account associated with this Client — via membership (owner /
  // manager), via store assignment (associate), or via cross-client admin. One
  // list, one role per row. Powers the Clients > Logins panel.
  app.get('/clients/:clientId/logins', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const clientId = (req.params as any).clientId as string
    const exists = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
    if (!exists) return reply.code(404).send({ error: 'not_found' })

    const rows = await prisma.account.findMany({
      where: {
        OR: [
          { memberships: { some: { clientId } } },
          { storeAssignments: { some: { store: { clientId } } } },
        ],
      },
      orderBy: { email: 'asc' },
      include: {
        memberships: { where: { clientId }, select: { role: true } },
        storeAssignments: { include: { store: { select: { id: true, name: true, clientId: true } } } },
      },
    })

    return rows.map((a) => {
      const membershipRole = a.memberships[0]?.role ?? null
      const role = membershipRole === 'owner'
        ? 'owner'
        : membershipRole === 'manager'
          ? 'manager'
          : 'associate'
      return {
        id: a.id,
        email: a.email,
        name: a.name,
        role,
        membershipRole,
        isAdmin: a.isAdmin,
        hasPassword: !!a.passwordHash,
        googleSubLinked: !!a.googleSub,
        disabledAt: a.disabledAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
        tokenVersion: a.tokenVersion,
        lifecycleEmailsOptOut: a.lifecycleEmailsOptOut,
        stores: a.storeAssignments.map((sa) => ({
          id: sa.store.id, name: sa.store.name, clientId: sa.store.clientId,
        })),
      }
    })
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
        triggeredById: op.accountId,
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
        triggeredById: op.accountId,
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

  // ----- Email template preview / test send -----
  //
  // Gated by INTERNAL_ADMIN_TOKEN (header: x-admin-token), separate from the
  // operator-bearer flow other admin routes use. Lets an internal user render
  // any template and either inspect the HTML or fire a test send.
  //
  // POST /admin/email/preview
  //   body: { template: string, props: object, sendTo?: string }
  //   - sendTo absent → returns { subject, html }
  //   - sendTo present → sends via Resend (or logs in dev) and returns the result

  const EmailPreviewBody = z.object({
    template: z.string().min(1),
    props: z.record(z.any()).default({}),
    sendTo: z.string().email().optional(),
  })

  app.post('/email/preview', async (req, reply) => {
    const expected = process.env.INTERNAL_ADMIN_TOKEN
    if (!expected) return reply.code(503).send({ error: 'internal_admin_token_unset' })
    const provided = req.headers['x-admin-token']
    if (typeof provided !== 'string' || provided !== expected) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const parsed = EmailPreviewBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })

    const { template, props, sendTo } = parsed.data
    if (!(template in TEMPLATES)) {
      return reply.code(400).send({ error: 'unknown_template', available: Object.keys(TEMPLATES) })
    }
    const name = template as TemplateName

    try {
      if (sendTo) {
        const result = await sendTemplate(name, sendTo, props)
        if (!result.ok) return reply.code(502).send({ error: 'send_failed', message: result.error })
        return { ok: true, sent: true, to: sendTo, dryRun: result.dryRun ?? false, id: result.id ?? null }
      }
      const { subject, html } = await renderTemplate(name, props)
      return { ok: true, sent: false, template: name, subject, html }
    } catch (e: any) {
      return reply.code(500).send({ error: 'render_failed', message: e?.message ?? 'unknown' })
    }
  })

  // ──────────────────────────────────────────────────────────────────
  // EMAIL TEMPLATES — operator-editable copy
  //
  //   GET  /admin/email/templates       → list all DB-editable rows + which TS-only
  //   GET  /admin/email/templates/:name → single row (404 if not editable)
  //   PUT  /admin/email/templates/:name → upsert subject + body
  //
  // Operator JWT (isAdmin) gated. Editable set is the keys of EDITABLE_TEMPLATES;
  // anything outside that set returns 403 (variant-heavy templates like welcome
  // and dunning are TS-only in v1).
  // ──────────────────────────────────────────────────────────────────

  app.get('/email/templates', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } })
    const editableSet = new Set(EDITABLE_TEMPLATE_NAMES)
    const allNames = Object.keys(TEMPLATES)
    return {
      templates: allNames.map((name) => {
        const row = rows.find((r) => r.name === name)
        return {
          name,
          editable: editableSet.has(name as TemplateName),
          lifecycle: LIFECYCLE_TEMPLATES.has(name as TemplateName),
          subject: row?.subject ?? null,
          updatedAt: row?.updatedAt ?? null,
          propsExample: row?.propsExample ?? TEMPLATE_PROPS_EXAMPLES[name as TemplateName],
        }
      }),
    }
  })

  app.get<{ Params: { name: string } }>('/email/templates/:name', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const name = req.params.name
    if (!(name in TEMPLATES)) return reply.code(404).send({ error: 'unknown_template' })
    if (!EDITABLE_TEMPLATE_NAMES.includes(name as TemplateName)) {
      return reply.code(403).send({ error: 'not_editable', message: `${name} is variant-heavy and not DB-editable in v1.` })
    }
    const row = await prisma.emailTemplate.findUnique({ where: { name } })
    return {
      name,
      editable: true,
      lifecycle: LIFECYCLE_TEMPLATES.has(name as TemplateName),
      subject: row?.subject ?? '',
      body: row?.body ?? '',
      propsExample: row?.propsExample ?? TEMPLATE_PROPS_EXAMPLES[name as TemplateName],
      updatedAt: row?.updatedAt ?? null,
    }
  })

  const TemplateUpsertBody = z.object({
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(60_000),
    propsExample: z.record(z.any()).optional(),
  })

  app.put<{ Params: { name: string } }>('/email/templates/:name', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const name = req.params.name
    if (!(name in TEMPLATES)) return reply.code(404).send({ error: 'unknown_template' })
    if (!EDITABLE_TEMPLATE_NAMES.includes(name as TemplateName)) {
      return reply.code(403).send({ error: 'not_editable' })
    }
    const parsed = TemplateUpsertBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })

    const row = await prisma.emailTemplate.upsert({
      where: { name },
      update: {
        subject: parsed.data.subject,
        body: parsed.data.body,
        ...(parsed.data.propsExample ? { propsExample: parsed.data.propsExample as any } : {}),
      },
      create: {
        name,
        subject: parsed.data.subject,
        body: parsed.data.body,
        propsExample: (parsed.data.propsExample ?? TEMPLATE_PROPS_EXAMPLES[name as TemplateName]) as any,
      },
    })

    return {
      name: row.name,
      subject: row.subject,
      body: row.body,
      propsExample: row.propsExample,
      updatedAt: row.updatedAt,
    }
  })

  // POST /admin/email/lifecycle/run
  // Operator triggers a one-shot lifecycle drip pass. Body:
  //   { drip: 'icpUnfilled' | 'pauseEnding' | 'freeToCoreNudge' } → run that one
  //   {} → run all three (same as the daily cron tick)
  // Returns the dispatcher's stats. Idempotency log is the same as the cron's,
  // so already-sent recipients are skipped — fire-now is safe to spam.
  const LifecycleRunBody = z.object({
    drip: z.enum([
      'icpUnfilled', 'pauseEnding', 'freeToCoreNudge',
      'engagedFreeToCore', 'scalingCoreToPro', 'establishedCoreToPro',
    ]).optional(),
  })

  app.post('/email/lifecycle/run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = LifecycleRunBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })

    try {
      if (parsed.data.drip) {
        const stats = await runOneLifecycleDrip(parsed.data.drip as LifecycleDripName)
        return { ok: true, drip: parsed.data.drip, stats }
      }
      const stats = await runLifecycleEmails()
      return { ok: true, drip: 'all', stats }
    } catch (e: any) {
      req.log.error({ err: e }, 'admin_lifecycle_run_failed')
      return reply.code(500).send({ error: 'lifecycle_run_failed', message: e?.message ?? 'unknown' })
    }
  })

  // ──────────────────────────────────────────────────────────────────────
  // Comp tier — admin-granted free upgrades over the Stripe-paid tier.
  // Schema: 03-duke.md "Comp tier" section. Effective tier = max(tier, compTier)
  // while comp is unexpired. All transitions go through `applyTierChange`
  // which writes a `tier_change_logs` row in the same tx.
  // ──────────────────────────────────────────────────────────────────────

  // POST /admin/stores/:id/comp — grant or extend a comp.
  // Body: { tier: 'core'|'pro', reason: string, expiresAt?: ISO }
  // Rules:
  //   - tier must outrank the current effective tier (no-op grants rejected
  //     to force the operator to think before clicking).
  //   - reason required, ≥5 chars.
  //   - expiresAt optional; missing = open-ended comp.
  //   - Enterprise is excluded — there's no self-serve Stripe price for it,
  //     so an Enterprise comp would have no upgrade path on expiry. Add
  //     'enterprise' back to this enum when an Enterprise SKU exists.
  app.post('/stores/:id/comp', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id?: string } | undefined)?.id
    if (!id) return reply.code(400).send({ error: 'bad_id' })

    const Body = z.object({
      tier: z.enum(['core', 'pro']),
      reason: z.string().trim().min(5, 'reason must be at least 5 chars'),
      expiresAt: z.string().datetime().optional(),
    })
    const parsed = Body.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }

    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, tier: true, compTier: true, compExpiresAt: true },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })

    const fromTier = effectiveTier(store)
    const newComp = parsed.data.tier as Tier
    if (tierRank(newComp) <= tierRank(fromTier)) {
      return reply.code(400).send({
        error: 'comp_would_not_change_effective_tier',
        currentEffective: fromTier,
        requestedComp: newComp,
        hint: 'Comp must outrank current effective tier. Pick a higher tier or revoke first.',
      })
    }

    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
    if (expiresAt && expiresAt <= new Date()) {
      return reply.code(400).send({ error: 'expires_at_in_past' })
    }

    const updated = await applyTierChange({
      storeId: id,
      fromTier,
      data: {
        compTier: newComp,
        compExpiresAt: expiresAt,
        compReason: parsed.data.reason,
        compGrantedById: op.accountId,
        compGrantedAt: new Date(),
      },
      source: 'admin_comp',
      actorId: op.accountId,
      reason: parsed.data.reason,
      expiresAt,
    })

    return reply.send({
      ok: true,
      store: {
        id: updated.id,
        paidTier: updated.tier,
        compTier: updated.compTier,
        compExpiresAt: updated.compExpiresAt,
        effectiveTier: effectiveTier(updated),
      },
    })
  })

  // DELETE /admin/stores/:id/comp — revoke an active comp.
  // Body: { reason: string }
  // The Store row keeps the comp metadata cleared; audit trail lives in
  // tier_change_logs.
  app.delete('/stores/:id/comp', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id?: string } | undefined)?.id
    if (!id) return reply.code(400).send({ error: 'bad_id' })

    const Body = z.object({ reason: z.string().trim().min(5) })
    const parsed = Body.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }

    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, tier: true, compTier: true, compExpiresAt: true },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    if (!store.compTier) return reply.code(400).send({ error: 'no_active_comp' })

    const fromTier = effectiveTier(store)
    const updated = await applyTierChange({
      storeId: id,
      fromTier,
      data: {
        compTier: null,
        compExpiresAt: null,
        compReason: null,
        compGrantedById: null,
        compGrantedAt: null,
      },
      source: 'admin_revoke',
      actorId: op.accountId,
      reason: parsed.data.reason,
    })

    return reply.send({
      ok: true,
      store: {
        id: updated.id,
        paidTier: updated.tier,
        compTier: updated.compTier,
        compExpiresAt: updated.compExpiresAt,
        effectiveTier: effectiveTier(updated),
      },
    })
  })

  // GET /admin/stores/:id/tier-history — audit log for one Store, newest first.
  app.get('/stores/:id/tier-history', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id?: string } | undefined)?.id
    if (!id) return reply.code(400).send({ error: 'bad_id' })

    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, tier: true, compTier: true, compExpiresAt: true, compReason: true, compGrantedById: true, compGrantedAt: true },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })

    const rows = await prisma.tierChangeLog.findMany({
      where: { storeId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    // Resolve actor emails for the audit panel.
    const actorIds = Array.from(new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x)))
    const actors = actorIds.length
      ? await prisma.account.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : []
    const actorEmail = new Map(actors.map((a) => [a.id, a.email]))

    return reply.send({
      store: {
        id: store.id,
        paidTier: store.tier,
        compTier: store.compTier,
        compExpiresAt: store.compExpiresAt,
        compReason: store.compReason,
        compGrantedAt: store.compGrantedAt,
        compGrantedByEmail: store.compGrantedById ? actorEmail.get(store.compGrantedById) ?? null : null,
        effectiveTier: effectiveTier(store),
      },
      history: rows.map((r) => ({
        id: r.id,
        fromTier: r.fromTier,
        toTier: r.toTier,
        source: r.source,
        actorEmail: r.actorId ? actorEmail.get(r.actorId) ?? null : null,
        reason: r.reason,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
    })
  })

  // POST /admin/email/pause-auto-resume/run
  // Operator triggers the auto-resume scan on demand. Same logic the daily
  // cron runs — finds any Store with pausedUntil <= now and flips Stripe
  // pause_collection back off. Idempotent: a Store with pausedUntil = null
  // is filtered out, so re-runs on already-resumed Stores are no-ops.
  app.post('/email/pause-auto-resume/run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    try {
      const stats = await runPauseAutoResume()
      return { ok: true, stats }
    } catch (e: any) {
      req.log.error({ err: e }, 'admin_pause_auto_resume_run_failed')
      return reply.code(500).send({ error: 'pause_auto_resume_failed', message: e?.message ?? 'unknown' })
    }
  })

  // POST /admin/comp-expiry/run — operator-triggered comp expiry pass.
  // Same code path as the daily cron. Runs warning + ended emails and
  // clears expired comps from Store rows. Idempotent across runs.
  app.post('/comp-expiry/run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    try {
      const stats = await runCompExpiryCron()
      return { ok: true, stats }
    } catch (e: any) {
      req.log.error({ err: e }, 'admin_comp_expiry_run_failed')
      return reply.code(500).send({ error: 'comp_expiry_failed', message: e?.message ?? 'unknown' })
    }
  })

  // GET /admin/song-load-failures?days=7 — songs whose audio URL the player
  // could not load, aggregated. Surfaces dead R2 objects, CORS regressions,
  // and expired share links that would otherwise only show up as cryptic
  // skipped tracks. Default window is 7 days.
  app.get('/song-load-failures', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const q = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'bad_query' })
    const since = new Date(Date.now() - q.data.days * 24 * 60 * 60 * 1000)

    const events = await prisma.playbackEvent.findMany({
      where: { eventType: 'song_load_failed' as any, songId: { not: null }, occurredAt: { gte: since } },
      select: { songId: true, storeId: true, occurredAt: true, extra: true },
      orderBy: { occurredAt: 'desc' },
    })
    if (events.length === 0) return { sinceDays: q.data.days, songs: [] }

    type Bucket = {
      songId: string
      failCount: number
      lastFailedAt: Date
      reasons: Record<string, number>
      storeIds: Set<string>
      lastAudioUrl: string | null
    }
    const bySong = new Map<string, Bucket>()
    for (const e of events) {
      if (!e.songId) continue
      let b = bySong.get(e.songId)
      if (!b) {
        b = { songId: e.songId, failCount: 0, lastFailedAt: e.occurredAt, reasons: {}, storeIds: new Set(), lastAudioUrl: null }
        bySong.set(e.songId, b)
      }
      b.failCount++
      const reason = (e.extra as any)?.reason as string | undefined
      if (reason) b.reasons[reason] = (b.reasons[reason] ?? 0) + 1
      if (e.occurredAt > b.lastFailedAt) {
        b.lastFailedAt = e.occurredAt
        const url = (e.extra as any)?.audio_url as string | undefined
        if (url) b.lastAudioUrl = url
      }
      b.storeIds.add(e.storeId)
    }

    const songIds = [...bySong.keys()]
    const songs = await prisma.song.findMany({
      where: { id: { in: songIds } },
      select: { id: true, r2Url: true, r2ObjectKey: true },
    })
    const songIndex = new Map(songs.map((s) => [s.id, s]))

    return {
      sinceDays: q.data.days,
      songs: [...bySong.values()]
        .sort((a, b) => b.failCount - a.failCount)
        .map((b) => ({
          songId: b.songId,
          failCount: b.failCount,
          lastFailedAt: b.lastFailedAt,
          reasons: b.reasons,
          storeCount: b.storeIds.size,
          r2Url: songIndex.get(b.songId)?.r2Url ?? null,
          r2ObjectKey: songIndex.get(b.songId)?.r2ObjectKey ?? null,
          lastAudioUrl: b.lastAudioUrl,
        })),
    }
  })
}
