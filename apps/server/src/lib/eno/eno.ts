// Card 14 Eno (Seed Builder) — orchestrates batch generation of SongSeeds.
// One SongSeed = one assembled Suno-ready Final Song Prompt: hook + ref track + Style Builder output + Lyric Writer output.
//
// Per Card 14 spec, OutcomeFactorPrompt prepends Outcome fields onto the style portion.
// Locked 2026-04-25 (Daniel's Suno reality check): Song Outcome Specs stay OUT of the style portion
// entirely; tempo/mode/dynamics live on Suno's separate params. The OutcomeFactorPrompt row is
// preserved for provenance but seeded as an empty template so the prepend is a no-op. Admin can flip
// this on if the policy ever changes.

import { prisma } from '../../db.js'
import { marsAssemble } from '../mars/mars.js'
import { generateLyrics } from '../bernie/bernie.js'

export const OUTCOME_FACTOR_PROMPT_SEED = '' // empty by default; see header note.

export async function getOrSeedOutcomeFactorPrompt(): Promise<{ id: string; version: number; templateText: string }> {
  const row = await prisma.outcomeFactorPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return row
  return prisma.outcomeFactorPrompt.create({
    data: { version: 1, templateText: OUTCOME_FACTOR_PROMPT_SEED, notes: 'Auto-seeded v1 (empty — outcome stays on Suno params, not style)' },
  })
}

export function applyOutcomeFactorPrompt(stylePortion: string, outcome: { tempoBpm: number; mode: string; dynamics: string | null; instrumentation: string | null }, templateText: string): string {
  if (!templateText.trim()) return stylePortion
  const filled = templateText
    .replace(/\{tempo_bpm\}/g, String(outcome.tempoBpm))
    .replace(/\{mode\}/g, outcome.mode)
    .replace(/\{dynamics\}/g, outcome.dynamics ?? '')
    .replace(/\{instrumentation\}/g, outcome.instrumentation ?? '')
  return `${filled.trim()} ${stylePortion}`
}

export interface SeedBuilderOptions {
  icpId: string
  outcomeId: string
  n: number
  triggeredBy: 'manual' | 'cron'
  triggeredByUser?: string
}

export interface SeedBuilderResult {
  songSeedBatchId: string
  requestedN: number
  producedN: number
  reason: 'complete' | 'pool_exhausted' | 'precheck_failed'
  errors: string[]
}

export async function runEno(opts: SeedBuilderOptions): Promise<SeedBuilderResult> {
  const batch = await prisma.songSeedBatch.create({
    data: {
      icpId: opts.icpId,
      outcomeId: opts.outcomeId,
      requestedN: opts.n,
      triggeredBy: opts.triggeredBy,
      triggeredByUser: opts.triggeredByUser ?? null,
    },
  })

  const outcome = await prisma.outcome.findUnique({ where: { id: opts.outcomeId } })
  if (!outcome || outcome.supersededAt) {
    await prisma.songSeedBatch.update({ where: { id: batch.id }, data: { producedN: 0, reason: 'precheck_failed', finishedAt: new Date() } })
    return { songSeedBatchId: batch.id, requestedN: opts.n, producedN: 0, reason: 'precheck_failed', errors: ['outcome_missing_or_superseded'] }
  }

  let produced = 0
  const errors: string[] = []
  let exhausted = false

  for (let i = 0; i < opts.n; i++) {
    try {
      const result = await createSongSeed(batch.id, opts.icpId, opts.outcomeId)
      if (!result.ok) {
        errors.push(result.reason ?? 'unknown')
        if (result.reason === 'pool_exhausted_hooks' || result.reason === 'pool_exhausted_reference_tracks') {
          exhausted = true
          break
        }
      } else {
        produced++
      }
    } catch (e: any) {
      errors.push(`unexpected: ${e.message ?? e}`)
    }
  }

  const reason: SeedBuilderResult['reason'] = exhausted ? 'pool_exhausted' : 'complete'
  await prisma.songSeedBatch.update({
    where: { id: batch.id },
    data: { producedN: produced, reason, finishedAt: new Date() },
  })

  return { songSeedBatchId: batch.id, requestedN: opts.n, producedN: produced, reason, errors }
}

interface CreateSongSeedResult {
  ok: boolean
  songSeedId?: string
  reason?: string
}

async function createSongSeed(songSeedBatchId: string, icpId: string, outcomeId: string): Promise<CreateSongSeedResult> {
  const hook = await pickAvailableHook(icpId, outcomeId)
  if (!hook) return { ok: false, reason: 'pool_exhausted_hooks' }

  const refTrack = await pickReferenceTrack(icpId)
  if (!refTrack || !refTrack.styleAnalysis) return { ok: false, reason: 'pool_exhausted_reference_tracks' }

  const songSeed = await prisma.songSeed.create({
    data: {
      songSeedBatchId, icpId, hookId: hook.id, outcomeId, referenceTrackId: refTrack.id, status: 'assembling',
    },
  })

  try {
    const outcome = await prisma.outcome.findUniqueOrThrow({ where: { id: outcomeId } })
    const styleAnalysis = refTrack.styleAnalysis
    const mars = await marsAssemble(styleAnalysis, outcome)

    const outcomeFactorPrompt = await getOrSeedOutcomeFactorPrompt()
    const finalStyle = applyOutcomeFactorPrompt(mars.style, outcome, outcomeFactorPrompt.templateText)

    const client = await prisma.client.findUnique({ where: { id: (await prisma.iCP.findUniqueOrThrow({ where: { id: icpId } })).clientId } })
    const lyrics = await generateLyrics({
      hookText: hook.text,
      brandLyricGuidelines: client?.brandLyricGuidelines ?? null,
    })

    await prisma.songSeed.update({
      where: { id: songSeed.id },
      data: {
        status: 'queued',
        style: finalStyle,
        stylePortionRaw: mars.style,
        negativeStyle: mars.negativeStyle,
        vocalGender: mars.vocalGender,
        lyrics: lyrics.lyrics,
        title: lyrics.title,
        outcomeFactorPromptVersion: outcomeFactorPrompt.version,
        styleTemplateVersion: mars.styleTemplateVersion,
        lyricDraftPromptVersion: lyrics.draftPromptVersion,
        lyricEditPromptVersion: lyrics.editPromptVersion,
        firedExclusionRuleIds: mars.firedExclusionRuleIds,
      },
    })

    return { ok: true, songSeedId: songSeed.id }
  } catch (e: any) {
    await prisma.songSeed.update({
      where: { id: songSeed.id },
      data: { status: 'failed', errorText: e?.message ?? String(e) },
    })
    return { ok: false, reason: `assembly_failed: ${e?.message ?? e}` }
  }
}

async function pickAvailableHook(icpId: string, outcomeId: string): Promise<{ id: string; text: string } | null> {
  const hooks = await prisma.hook.findMany({
    where: { icpId, outcomeId, status: 'approved' },
    select: {
      id: true, text: true,
      songSeeds: { select: { status: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  for (const h of hooks) {
    const blocking = h.songSeeds.some((s) => s.status === 'assembling' || s.status === 'queued' || s.status === 'accepted')
    if (!blocking) return { id: h.id, text: h.text }
  }
  return null
}

type RefTrackWithAnalysis = Awaited<ReturnType<typeof prisma.referenceTrack.findFirstOrThrow<{ include: { styleAnalysis: true } }>>>

async function pickReferenceTrack(icpId: string): Promise<RefTrackWithAnalysis | null> {
  const tracks = await prisma.referenceTrack.findMany({
    where: { icpId, styleAnalysis: { isNot: null } },
    include: { styleAnalysis: true },
    orderBy: [{ useCount: 'asc' }, { createdAt: 'asc' }],
    take: 1,
  })
  const t = tracks[0]
  if (!t || !t.styleAnalysis) return null
  return t as RefTrackWithAnalysis
}
