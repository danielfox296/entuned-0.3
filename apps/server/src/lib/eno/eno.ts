// Eno (Seed Builder) — orchestrates batch generation of SongSeeds.
// One SongSeed = one assembled Suno-ready Final Song Prompt: hook + ref track + Style Builder output + Lyric Writer output.
//
// OutcomeFactorPrompt prepends Outcome fields onto the style portion per Card 14 spec.
// Default template prepends BPM and mode. Edit via admin /engine/outcome-factor-prompt.
//
// Lyric path uses genre-aware Bernie: the reference track's StyleAnalysis (plus
// Mars's anchor tag when available) is converted to a GenreBrief and threaded
// into Bernie's draft pass so lyric craft adapts to hip-hop / country / EDM /
// R&B / latin instead of defaulting to pop.

import { prisma } from '../../db.js'
import { marsAssemble, type StyleBuilderName } from '../mars/mars.js'
import { generateLyrics, type GenreBrief, type OutcomeBrief } from '../bernie/bernie.js'
import { injectArrangement, type ArrangementSections } from '../arranger/arranger.js'
import { resolveOutcomeParams } from '../variance/variance.js'
import { extractVocalGender, type VocalGender } from '../mars/vocal-gender.js'
import { pickFormArchetype } from './form-archetype.js'
import type { StyleAnalysis } from '@prisma/client'

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
  /** Mars style builder strategy for this batch. Defaults to STYLE_BUILDER env / 'router'. */
  styleBuilder?: StyleBuilderName
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
      const result = await createSongSeed(batch.id, opts.icpId, opts.outcomeId, opts.styleBuilder)
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

export interface CreateSongSeedResult {
  ok: boolean
  songSeedId?: string
  reason?: string
}

async function createSongSeed(songSeedBatchId: string, icpId: string, outcomeId: string, styleBuilder?: StyleBuilderName): Promise<CreateSongSeedResult> {
  const hook = await pickAvailableHook(icpId, outcomeId)
  if (!hook) return { ok: false, reason: 'pool_exhausted_hooks' }

  // Outcome is guaranteed to exist + be non-superseded by runEno's precheck,
  // but createSongSeed is also exported-shape-accessible via test scripts;
  // fetch once and use both for the picker gate and Mars assembly.
  const outcome = await prisma.outcome.findUnique({ where: { id: outcomeId } })
  if (!outcome) return { ok: false, reason: 'outcome_not_found' }

  const pickResult = await pickReferenceTrack(icpId, hook.vocalGender, outcome.tempoBpm, outcome.mode)
  if (!pickResult.ok) {
    if (pickResult.reason === 'no_outcome_tempo_match') {
      return { ok: false, reason: `pool_exhausted_reference_tracks_outcome_tempo_${outcome.tempoBpm}` }
    }
    if (pickResult.reason === 'no_outcome_mode_match') {
      return { ok: false, reason: `pool_exhausted_reference_tracks_outcome_mode_${outcome.mode}` }
    }
    if (pickResult.reason === 'no_vocal_gender_match' && hook.vocalGender) {
      return { ok: false, reason: `pool_exhausted_reference_tracks_for_hook_vocal_gender_${hook.vocalGender}` }
    }
    return { ok: false, reason: 'pool_exhausted_reference_tracks' }
  }
  const refTrack = pickResult.ref

  const songSeed = await prisma.songSeed.create({
    data: {
      songSeedBatchId, icpId, hookId: hook.id, outcomeId, referenceTrackId: refTrack.id, status: 'assembling',
    },
  })

  try {
    // The picker's where clause filters `styleAnalysis: { isNot: null }`, but
    // Prisma's typings still mark the included relation as nullable. Narrow here.
    if (!refTrack.styleAnalysis) throw new Error('refTrack.styleAnalysis missing after picker filter')
    const styleAnalysis = refTrack.styleAnalysis
    const mars = await marsAssemble(styleAnalysis, outcome, { year: refTrack.year, styleBuilder })

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

    // Pick a form archetype before Bernie runs. The archetype determines the song's
    // section list (V/C/V/C/Bridge/FC, AABA, VCVC, etc.) — Bernie writes lyrics into
    // whatever shape the selector picks. Selector falls back to the legacy default
    // when the DB has no active archetypes, so behavior is safe pre-seed.
    const formArchetype = await pickFormArchetype({
      outcomeKey: outcome.outcomeKey,
      arrangementSections: arrangementSections ?? null,
      referenceYear: refTrack.year ?? null,
    })

    // Genre brief from the reference track's StyleAnalysis. Mars's anchor tag is
    // the most genre-accurate signal when present; otherwise fall back to the
    // leading vibePitch fragment. Either way Bernie sees a `genreTag` plus
    // groove/harmonic/vocal-register/era fields to steer the draft.
    const genreBrief = extractGenreBrief(styleAnalysis, refTrack.year, mars.anchor?.tag ?? null)

    // Outcome brief — the affective target. Use *resolved* tempo/mode (post-
    // variance) so Bernie writes against the same values Suno will render.
    // Mood doesn't vary; passed straight from the Outcome row.
    const outcomeBrief: OutcomeBrief = {
      mood: outcome.mood,
      tempoBpm: resolved.tempoBpm,
      mode: resolved.mode,
    }

    const lyricsRaw = await generateLyrics({
      hookText: hook.text,
      brandLyricGuidelines: client?.brandLyricGuidelines ?? null,
      arrangementSections: arrangementSections ?? null,
      formArchetype,
      genreBrief,
      outcomeBrief,
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
        genreBrief: JSON.stringify(genreBrief),
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

// --- GenreBrief extraction -------------------------------------------------
//
// Turns a reference track's StyleAnalysis (plus the Mars anchor tag when
// available) into the structured brief Bernie's draft pass consumes.

const GROOVE_TERMS = new Set([
  'loose', 'tight', 'swung', 'behind-the-beat', 'on-the-grid', 'syncopated',
  'polyrhythmic', 'straight', 'triplet', 'sidechained', 'mid-tempo', 'uptempo',
  'downtempo', 'half-time', 'pocket', 'laid-back', 'pushed',
])

const REGISTER_TERMS = [
  'tenor', 'baritone', 'bass', 'alto', 'mezzo', 'soprano',
  'falsetto', 'head voice', 'chest voice',
]

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

function extractVocalRegister(vocalCharacter: string): string {
  const lower = vocalCharacter.toLowerCase()
  for (const term of REGISTER_TERMS) {
    if (lower.includes(term)) return term
  }
  return ''
}

export type HookVocalGender = 'male' | 'female' | 'duet' | null

export async function pickAvailableHook(icpId: string, outcomeId: string): Promise<{ id: string; text: string; vocalGender: HookVocalGender } | null> {
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

export type RefTrackWithAnalysis = Awaited<ReturnType<typeof prisma.referenceTrack.findFirstOrThrow<{ include: { styleAnalysis: true } }>>>

// True if a ref track's vocal lead is compatible with the hook's vocal-gender
// constraint. Null hookGender = unconstrained (any vocal track passes; only
// instrumentals are excluded). Set hookGender = strict match required.
export function vocalGenderCompatible(refGender: VocalGender, hookGender: HookVocalGender): boolean {
  if (refGender === 'instrumental') return false
  if (!hookGender) return true
  if (hookGender === 'duet') return refGender === 'duet'
  // Hook 'male' or 'female' — match same primary gender, plus duets which contain that voice.
  return refGender === hookGender || refGender === 'duet'
}

// Outcome → ref tempo gate. Refs without a decomposed BPM pass through
// (lazy backfill on re-decompose); refs with a BPM must be within ±7 of the
// outcome's tempo. See schema/05-reference-track-decomposition.md
// "The BPM doctrine, restated".
export const OUTCOME_TEMPO_TOLERANCE_BPM = 7
export function bpmCompatible(refBpm: number | null | undefined, outcomeTempoBpm: number): boolean {
  if (refBpm == null) return true
  return Math.abs(refBpm - outcomeTempoBpm) <= OUTCOME_TEMPO_TOLERANCE_BPM
}

// Mode hint extraction. StyleAnalysis has no structured mode field; major/minor
// is mentioned (or not) in the freeform harmonic_and_groove + vocal text. Returns
// 'major' or 'minor' only when one token appears unambiguously; null otherwise
// (ambiguous, modal, or simply unspecified). Conservative by design — we only
// want to reject a ref when the contradiction is obvious.
const MAJOR_RE = /\bmajor[- ]?(?:key|scale|tonality|mode|chord(?:s)?)?\b/i
const MINOR_RE = /\bminor[- ]?(?:key|scale|tonality|mode|chord(?:s)?)?\b/i
export function extractModeHint(text: string | null | undefined): 'major' | 'minor' | null {
  if (!text) return null
  const hasMajor = MAJOR_RE.test(text)
  const hasMinor = MINOR_RE.test(text)
  if (hasMajor && !hasMinor) return 'major'
  if (hasMinor && !hasMajor) return 'minor'
  return null
}

// Outcome → ref mode gate. Conservative: passes when either side is unknown,
// only rejects when both the outcome mode and the ref mode are clearly named
// and they disagree. Modal/dorian/etc. on either side defaults to pass —
// Suno doesn't steer modally anyway, so blocking those would over-filter.
export function modeCompatible(refMode: 'major' | 'minor' | null, outcomeMode: string): boolean {
  if (refMode == null) return true
  const lower = outcomeMode.toLowerCase()
  const outcomeWantsMajor = /\bmajor\b/.test(lower)
  const outcomeWantsMinor = /\bminor\b/.test(lower)
  if (outcomeWantsMajor && !outcomeWantsMinor) return refMode === 'major'
  if (outcomeWantsMinor && !outcomeWantsMajor) return refMode === 'minor'
  return true
}

export type PickRefResult =
  | { ok: true; ref: RefTrackWithAnalysis }
  | { ok: false; reason: 'no_approved_with_analysis' | 'no_vocal_gender_match' | 'no_outcome_tempo_match' | 'no_outcome_mode_match' }

export async function pickReferenceTrack(
  icpId: string,
  hookGender: HookVocalGender,
  outcomeTempoBpm: number,
  outcomeMode?: string,
): Promise<PickRefResult> {
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
  if (tracks.length === 0) return { ok: false, reason: 'no_approved_with_analysis' }

  // Filter 1: vocal-gender compatibility. Exclude instrumentals universally;
  // also exclude refs whose vocal lead doesn't match the hook's constraint.
  const vocalCompatible = tracks.filter((t) => {
    if (!t.styleAnalysis) return false
    const vocalText = [t.styleAnalysis.vocalCharacter, t.styleAnalysis.vocalArrangement]
      .filter(Boolean)
      .join(' · ')
    const refGender = extractVocalGender(vocalText)
    return vocalGenderCompatible(refGender, hookGender)
  })
  if (vocalCompatible.length === 0) return { ok: false, reason: 'no_vocal_gender_match' }

  // Filter 2: outcome tempo compatibility (±7bpm). Refs whose StyleAnalysis
  // has no decomposed BPM pass through — they get filtered on next decompose.
  const tempoCompatible = vocalCompatible.filter((t) => bpmCompatible(t.styleAnalysis?.bpm, outcomeTempoBpm))
  if (tempoCompatible.length === 0) return { ok: false, reason: 'no_outcome_tempo_match' }

  // Filter 3: outcome mode compatibility. Conservative — only rejects when
  // both sides clearly name a key and they disagree. Modal/dorian/unspecified
  // refs pass through; the prepend handles mode signaling for Suno.
  const modeFiltered = outcomeMode
    ? tempoCompatible.filter((t) => {
        const refMode = extractModeHint(
          [t.styleAnalysis?.harmonicAndGroove, t.styleAnalysis?.vibePitch].filter(Boolean).join(' · '),
        )
        return modeCompatible(refMode, outcomeMode)
      })
    : tempoCompatible
  if (modeFiltered.length === 0) return { ok: false, reason: 'no_outcome_mode_match' }

  const scored = modeFiltered.map((t) => {
    const inFlight = t.songSeeds.filter(
      (s) => s.status === 'assembling' || s.status === 'queued' || s.status === 'accepted',
    ).length
    return { t, score: t.useCount + inFlight }
  })
  scored.sort((a, b) => (a.score - b.score) || (Math.random() - 0.5))

  const winner = scored[0]?.t
  if (!winner || !winner.styleAnalysis) return { ok: false, reason: 'no_approved_with_analysis' }
  return { ok: true, ref: winner as unknown as RefTrackWithAnalysis }
}
