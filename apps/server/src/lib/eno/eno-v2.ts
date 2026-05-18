// Eno-2 orchestrator — genre-aware seed generation pipeline.
//
// Parallel to createSongSeed() in eno.ts (Eno-1). Reuses the same hook picker,
// ref track picker, Mars, variance, outcome factor prompt, and arranger. Swaps in
// Bernie-v2 (genre-aware lyrics) and extracts a genre brief from the StyleAnalysis
// that already exists on the reference track.
//
// Toggle: `pipeline: 'eno-2'` on SeedBuilderOptions. Eno-1 dispatches here when
// that flag is set; otherwise runs its own unchanged createSongSeed().
//
// EXPERIMENT SURFACE — opt-in Eno-2 lane.
//   Eno-1 (eno.ts) is the production default; Eno-2 fires only when an
//   operator sets the Dash toggle to "Eno-2" (persisted per-browser in
//   localStorage). Default fallbacks point to Eno-1 in two independent places:
//   server `runEno` (eno.ts:60) and the Dash UI state
//   (apps/admin/src/panels/seeding/SongSeedQueue.tsx:69).
//
//   This file is a thin extension of eno.ts — every shared helper is imported
//   from there (see lines 17-23). The substantive diffs vs Eno-1 are:
//     (a) calls `generateLyricsV2` from bernie-v2.ts instead of
//         `generateLyrics` from bernie.ts,
//     (b) writes the SongSeed.pipeline column ('eno-2'),
//     (c) writes the SongSeed.genreBrief column (JSON), and
//     (d) the Eno-2-only `extractGenreBrief` helper below.
//
//   The shape of this file may continue to change while Eno-2 is being tested.
//   See ./README.md for the full module contract.

import { prisma } from '../../db.js'
import { marsAssemble, type StyleBuilderName } from '../mars/mars.js'
import { generateLyricsV2, type GenreBrief } from '../bernie/bernie-v2.js'
import { injectArrangement, type ArrangementSections } from '../arranger/arranger.js'
import { resolveOutcomeParams } from '../variance/variance.js'
import { pickFormArchetype } from './form-archetype.js'
import {
  getOrSeedOutcomeFactorPrompt,
  applyOutcomeFactorPrompt,
  pickAvailableHook,
  pickReferenceTrack,
  type CreateSongSeedResult,
} from './eno.js'
import type { StyleAnalysis } from '@prisma/client'

export function extractGenreBrief(
  styleAnalysis: StyleAnalysis,
  refTrackYear: number | null | undefined,
  anchorTag?: string | null,
): GenreBrief {
  const genreTag = anchorTag
    ?? extractLeadingGenre(styleAnalysis.vibePitch)
    ?? 'pop'

  const harmAndGroove = styleAnalysis.harmonicAndGroove ?? ''
  const commaIdx = harmAndGroove.lastIndexOf(',')
  let harmonicCharacter: string
  let grooveCharacter: string
  if (commaIdx > 0) {
    const parts = splitHarmonicAndGroove(harmAndGroove)
    harmonicCharacter = parts.harmonic
    grooveCharacter = parts.groove
  } else {
    harmonicCharacter = harmAndGroove.trim()
    grooveCharacter = ''
  }

  const vocalRegister = extractVocalRegister(styleAnalysis.vocalCharacter ?? '')

  const eraDecade = typeof refTrackYear === 'number'
    ? `${Math.floor(refTrackYear / 10) * 10}s`
    : ''

  return { genreTag, grooveCharacter, harmonicCharacter, vocalRegister, eraDecade }
}

const GROOVE_TERMS = new Set([
  'loose', 'tight', 'swung', 'behind-the-beat', 'on-the-grid', 'syncopated',
  'polyrhythmic', 'straight', 'triplet', 'sidechained', 'mid-tempo', 'uptempo',
  'downtempo', 'half-time', 'pocket', 'laid-back', 'pushed',
])

function splitHarmonicAndGroove(text: string): { harmonic: string; groove: string } {
  const fragments = text.split(',').map((s) => s.trim()).filter(Boolean)
  const grooveParts: string[] = []
  const harmonicParts: string[] = []
  for (const f of fragments) {
    const lower = f.toLowerCase()
    const isGroove = [...GROOVE_TERMS].some((t) => lower.includes(t))
    if (isGroove) grooveParts.push(f)
    else harmonicParts.push(f)
  }
  return {
    harmonic: harmonicParts.join(', '),
    groove: grooveParts.join(', '),
  }
}

function extractLeadingGenre(vibePitch: string | null): string | null {
  if (!vibePitch) return null
  const firstComma = vibePitch.indexOf(',')
  const lead = firstComma > 0 ? vibePitch.slice(0, firstComma).trim() : vibePitch.trim()
  if (lead.length > 60) return lead.slice(0, 60).trim()
  return lead || null
}

const REGISTER_TERMS = [
  'tenor', 'baritone', 'bass', 'alto', 'mezzo', 'soprano',
  'falsetto', 'head voice', 'chest voice',
]

function extractVocalRegister(vocalCharacter: string): string {
  const lower = vocalCharacter.toLowerCase()
  for (const term of REGISTER_TERMS) {
    if (lower.includes(term)) return term
  }
  return ''
}

export async function createSongSeedV2(
  songSeedBatchId: string,
  icpId: string,
  outcomeId: string,
  styleBuilder?: StyleBuilderName,
): Promise<CreateSongSeedResult> {
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
      songSeedBatchId, icpId, hookId: hook.id, outcomeId,
      referenceTrackId: refTrack.id, status: 'assembling', pipeline: 'eno-2',
    },
  })

  try {
    const outcome = await prisma.outcome.findUniqueOrThrow({ where: { id: outcomeId } })
    const styleAnalysis = refTrack.styleAnalysis
    const mars = await marsAssemble(styleAnalysis, outcome, { year: refTrack.year, styleBuilder })

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

    const arrangementSections = (styleAnalysis as { arrangementSections?: unknown }).arrangementSections as
      | ArrangementSections
      | null
      | undefined
    const arrangementVersion = (styleAnalysis as { arrangementVersion?: number | null }).arrangementVersion ?? null

    const formArchetype = await pickFormArchetype({
      outcomeKey: outcome.outcomeKey,
      arrangementSections: arrangementSections ?? null,
      referenceYear: refTrack.year ?? null,
    })

    // Genre brief extraction — the Eno-2 addition. Uses the anchor tag from Mars
    // when available (anchor builder produces the most genre-accurate tag), falls
    // back to extracting from vibePitch.
    const genreBrief = extractGenreBrief(
      styleAnalysis,
      refTrack.year,
      mars.anchor?.tag ?? null,
    )

    const lyricsRaw = await generateLyricsV2({
      hookText: hook.text,
      brandLyricGuidelines: client?.brandLyricGuidelines ?? null,
      arrangementSections: arrangementSections ?? null,
      formArchetype,
      genreBrief,
    })

    const finalLyrics = injectArrangement(lyricsRaw.lyrics, arrangementSections ?? {})

    await prisma.songSeed.update({
      where: { id: songSeed.id },
      data: {
        status: 'queued',
        pipeline: 'eno-2',
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
        genreBrief: JSON.stringify(genreBrief),
      },
    })

    return { ok: true, songSeedId: songSeed.id }
  } catch (e: any) {
    await prisma.songSeed.update({
      where: { id: songSeed.id },
      data: { status: 'failed', pipeline: 'eno-2', errorText: e?.message ?? String(e) },
    })
    return { ok: false, reason: `assembly_failed: ${e?.message ?? e}` }
  }
}
