// Card 14 Eno (Seed Builder) — orchestrates batch generation of SongSeeds.
// One SongSeed = one assembled Suno-ready Final Song Prompt: hook + ref track + Style Builder output + Lyric Writer output.
//
// OutcomeFactorPrompt prepends Outcome fields onto the style portion per Card 14 spec.
// Default template prepends BPM and mode. Edit via admin /engine/outcome-factor-prompt.

import { prisma } from '../../db.js'
import { marsAssemble } from '../mars/mars.js'
import { generateLyrics } from '../bernie/bernie.js'
import { injectArrangement, type ArrangementSections } from '../arranger/arranger.js'
import { resolveOutcomeParams } from '../variance/variance.js'
import { extractVocalGender, type VocalGender } from '../mars/vocal-gender.js'

export const OUTCOME_FACTOR_PROMPT_SEED = '{mood}, {tempo_bpm}bpm, {mode}' // prepended to style string. Mood is required on Outcome and leads the prefix as the affect anchor. Tokens {dynamics} {instrumentation} still resolve for backward compat with old templates but are deprecated — they were stamping genre-mismatched instrument lists onto every track and using rules-v8 banned vocab.

export async function getOrSeedOutcomeFactorPrompt(): Promise<{ id: string; version: number; templateText: string }> {
  const row = await prisma.outcomeFactorPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return row
  return prisma.outcomeFactorPrompt.create({
    data: { version: 1, templateText: OUTCOME_FACTOR_PROMPT_SEED, notes: 'Auto-seeded v1 (empty — outcome stays on Suno params, not style)' },
  })
}

export function applyOutcomeFactorPrompt(stylePortion: string, outcome: { tempoBpm: number; mode: string; mood: string; dynamics: string | null; instrumentation: string | null }, templateText: string): string {
  if (!templateText.trim()) return stylePortion
  const filled = templateText
    .replace(/\{tempo_bpm\}/g, String(outcome.tempoBpm))
    .replace(/\{mode\}/g, outcome.mode)
    .replace(/\{mood\}/g, outcome.mood)
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

  const refTrack = await pickReferenceTrack(icpId, hook.vocalGender)
  if (!refTrack || !refTrack.styleAnalysis) {
    return {
      ok: false,
      reason: hook.vocalGender
        ? `pool_exhausted_reference_tracks_for_hook_vocal_gender_${hook.vocalGender}`
        : 'pool_exhausted_reference_tracks',
    }
  }

  const songSeed = await prisma.songSeed.create({
    data: {
      songSeedBatchId, icpId, hookId: hook.id, outcomeId, referenceTrackId: refTrack.id, status: 'assembling',
    },
  })

  try {
    const outcome = await prisma.outcome.findUniqueOrThrow({ where: { id: outcomeId } })
    const styleAnalysis = refTrack.styleAnalysis
    const mars = await marsAssemble(styleAnalysis, outcome, { year: refTrack.year })

    // Variance resolution — samples concrete tempo/mode from the Outcome's distribution
    // when bands are configured. No-op (returns center values) when radius/weights are null.
    const resolved = resolveOutcomeParams({
      tempoBpm: outcome.tempoBpm,
      tempoBpmRadius: outcome.tempoBpmRadius,
      mode: outcome.mode,
      modeWeights: outcome.modeWeights,
    })

    const outcomeFactorPrompt = await getOrSeedOutcomeFactorPrompt()
    const finalStyle = applyOutcomeFactorPrompt(
      mars.style,
      { tempoBpm: resolved.tempoBpm, mode: resolved.mode, mood: outcome.mood, dynamics: outcome.dynamics, instrumentation: outcome.instrumentation },
      outcomeFactorPrompt.templateText,
    )

    const icpRow = await prisma.iCP.findUniqueOrThrow({ where: { id: icpId }, select: { clientId: true } })
    const client = await prisma.client.findUnique({ where: { id: icpRow.clientId } })

    // Arrangement comes from the reference track's StyleAnalysis. Decomposer rules-v6+
    // populate arrangement_sections; older decompositions have null and the arranger
    // is a no-op. Tracks naturally backfill as they're re-decomposed.
    //
    // Bernie receives the arrangement as a brief so it can match lyric density and
    // energy per section. The post-Bernie injectArrangement step then staples the
    // [Instrument: ...] tags onto the section headers for Suno.
    const arrangementSections = (styleAnalysis as { arrangementSections?: unknown }).arrangementSections as
      | ArrangementSections
      | null
      | undefined
    const arrangementVersion = (styleAnalysis as { arrangementVersion?: number | null }).arrangementVersion ?? null

    const lyricsRaw = await generateLyrics({
      hookText: hook.text,
      brandLyricGuidelines: client?.brandLyricGuidelines ?? null,
      arrangementSections: arrangementSections ?? null,
    })

    // Always run injectArrangement: even when arrangementSections is null, the
    // arranger performs the chorus-escalation pass (rename final [Chorus] to
    // [Final Chorus], add gang-vocal cues) so every track gets an energy arc.
    const finalLyrics = injectArrangement(lyricsRaw.lyrics, arrangementSections ?? {})

    await prisma.songSeed.update({
      where: { id: songSeed.id },
      data: {
        status: 'queued',
        style: finalStyle,
        stylePortionRaw: mars.style,
        negativeStyle: mars.negativeStyle,
        vocalGender: mars.vocalGender,
        lyrics: finalLyrics,
        title: lyricsRaw.title,
        outcomeFactorPromptVersion: outcomeFactorPrompt.version,
        styleTemplateVersion: mars.styleTemplateVersion,
        lyricDraftPromptVersion: lyricsRaw.draftPromptVersion,
        lyricEditPromptVersion: lyricsRaw.editPromptVersion,
        arrangementTemplateVersion: arrangementSections ? arrangementVersion : null,
        resolvedTempoBpm: resolved.tempoBpm,
        resolvedMode: resolved.mode,
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

type HookVocalGender = 'male' | 'female' | 'duet' | null

async function pickAvailableHook(icpId: string, outcomeId: string): Promise<{ id: string; text: string; vocalGender: HookVocalGender } | null> {
  const hooks = await prisma.hook.findMany({
    where: { icpId, outcomeId, status: 'approved' },
    select: {
      id: true, text: true, vocalGender: true,
      songSeeds: { select: { status: true } },
    },
    orderBy: [{ useCount: 'asc' }, { createdAt: 'asc' }],
  })
  for (const h of hooks) {
    const blocking = h.songSeeds.some((s) => s.status === 'assembling' || s.status === 'queued' || s.status === 'accepted')
    if (!blocking) {
      const vg = h.vocalGender as HookVocalGender
      return { id: h.id, text: h.text, vocalGender: vg }
    }
  }
  return null
}

type RefTrackWithAnalysis = Awaited<ReturnType<typeof prisma.referenceTrack.findFirstOrThrow<{ include: { styleAnalysis: true } }>>>

// True if a ref track's vocal lead is compatible with the hook's vocal-gender
// constraint. Null hookGender = unconstrained (any vocal track passes; only
// instrumentals are excluded). Set hookGender = strict match required.
function vocalGenderCompatible(refGender: VocalGender, hookGender: HookVocalGender): boolean {
  if (refGender === 'instrumental') return false
  if (!hookGender) return true
  if (hookGender === 'duet') return refGender === 'duet'
  // Hook 'male' or 'female' — match same primary gender, plus duets which contain that voice.
  return refGender === hookGender || refGender === 'duet'
}

async function pickReferenceTrack(icpId: string, hookGender: HookVocalGender): Promise<RefTrackWithAnalysis | null> {
  // useCount alone doesn't spread bursts: it only increments on operator
  // accept (admin.ts), so every iteration of a burst sees the same snapshot
  // and grabs the same lowest-useCount track. Add in-flight + already-
  // accepted seed counts to the score so each created seed naturally
  // pushes the next iteration toward a different track. Tiebreak randomly
  // so single-seed runs also vary across calls.
  const tracks = await prisma.referenceTrack.findMany({
    where: { icpId, status: 'approved', styleAnalysis: { isNot: null } },
    include: {
      styleAnalysis: true,
      songSeeds: { select: { status: true } },
    },
  })
  if (tracks.length === 0) return null

  // Filter: exclude instrumentals universally, and refs whose vocal gender
  // doesn't match the hook's gender constraint when one is set.
  const compatible = tracks.filter((t) => {
    if (!t.styleAnalysis) return false
    const vocalText = [t.styleAnalysis.vocalCharacter, t.styleAnalysis.vocalArrangement]
      .filter(Boolean)
      .join(' · ')
    const refGender = extractVocalGender(vocalText)
    return vocalGenderCompatible(refGender, hookGender)
  })
  if (compatible.length === 0) return null

  const scored = compatible.map((t) => {
    const inFlight = t.songSeeds.filter(
      (s) => s.status === 'assembling' || s.status === 'queued' || s.status === 'accepted',
    ).length
    return { t, score: t.useCount + inFlight }
  })
  scored.sort((a, b) => (a.score - b.score) || (Math.random() - 0.5))

  const winner = scored[0]?.t
  if (!winner || !winner.styleAnalysis) return null
  return winner as unknown as RefTrackWithAnalysis
}
