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
import { decompose, toStyleAnalysisData } from '../decomposer/decomposer.js'
import { marsAssemble } from '../mars/mars.js'
import { generateLyrics, type GenreBrief, type OutcomeBrief } from '../bernie/bernie.js'
import { runProfessor } from '../professor/professor.js'
import { runMusicProfessor } from '../music-professor/music-professor.js'
import { injectArrangement, type ArrangementSections } from '../arranger/arranger.js'
import { getOrSeedArrangementPolicy } from '../arranger/policy.js'
import { resolveOutcomeParams } from '../variance/variance.js'
// vocal-gender import removed 2026-05-23 — Hook.vocalGender now flows
// directly to Suno via the populate-songs vocal toggle, not via ref-track
// filtering. Hook.vocalGender remains for that purpose; see pickAvailableHook.
import { pickFormArchetype } from './form-archetype.js'
import type { StyleAnalysis } from '@prisma/client'

export const OUTCOME_FACTOR_PROMPT_SEED = '{mood}, {tempo_bpm}bpm, {mode}' // prepended to style string. Mood is required on Outcome and leads the prefix as the affect anchor.

export async function getOrSeedOutcomeFactorPrompt(): Promise<{ id: string; version: number; templateText: string }> {
  const row = await prisma.outcomeFactorPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return row
  return prisma.outcomeFactorPrompt.create({
    data: { version: 1, templateText: OUTCOME_FACTOR_PROMPT_SEED, notes: 'Auto-seeded v1 (empty — outcome stays on Suno params, not style)' },
  })
}

export function applyOutcomeFactorPrompt(stylePortion: string, outcome: { tempoBpm: number; mode: string; mood: string }, templateText: string): string {
  if (!templateText.trim()) return stylePortion
  const filled = templateText
    .replace(/\{tempo_bpm\}/g, String(outcome.tempoBpm))
    .replace(/\{mode\}/g, outcome.mode)
    .replace(/\{mood\}/g, outcome.mood)
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

export interface CreateSongSeedResult {
  ok: boolean
  songSeedId?: string
  reason?: string
}

async function createSongSeed(songSeedBatchId: string, icpId: string, outcomeId: string): Promise<CreateSongSeedResult> {
  const hook = await pickAvailableHook(icpId, outcomeId)
  if (!hook) return { ok: false, reason: 'pool_exhausted_hooks' }

  // Outcome is guaranteed to exist + be non-superseded by runEno's precheck,
  // but createSongSeed is also exported-shape-accessible via test scripts;
  // fetch once and use both for the picker gate and Mars assembly.
  const outcome = await prisma.outcome.findUnique({ where: { id: outcomeId } })
  if (!outcome) return { ok: false, reason: 'outcome_not_found' }

  const pickResult = await pickReferenceTrack(icpId, outcome.tempoBpm)
  if (!pickResult.ok) {
    if (pickResult.reason === 'no_outcome_tempo_match') {
      return { ok: false, reason: `pool_exhausted_reference_tracks_outcome_tempo_${outcome.tempoBpm}` }
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
    // Normalize v13 structured columns back into the legacy prose field names so the
    // whole Mars subsystem (anchor builder, 5-axis exclusions, DB exclusion rules) and
    // Bernie read v13 rows without any per-consumer rewiring. No-op on pre-v13 rows.
    const styleAnalysis = normalizeStyleAnalysis(refTrack.styleAnalysis)
    const mars = await marsAssemble(styleAnalysis, outcome, { year: refTrack.year })

    // Variance resolution — samples concrete tempo/mode from the Outcome's distribution
    // when bands are configured. No-op (returns center values) when radius/weights are null.
    const resolved = resolveOutcomeParams({
      tempoBpm: outcome.tempoBpm,
      tempoBpmRadius: outcome.tempoBpmRadius,
      mode: outcome.mode,
      modeWeights: outcome.modeWeights,
    })

    // Music Professor pass — finishing editor for Mars's style + negativeStyle.
    // Runs BEFORE applyOutcomeFactorPrompt so the wrap rule (tempo/mode/mood
    // prepend) still applies cleanly on top of the polished style. Internally
    // falls back to Mars's input if the model strips the anchor, blows past
    // the caps, introduces banned tokens, or the API call fails — the layer
    // must never block seed generation.
    const musicProfessor = await runMusicProfessor({
      style: mars.style,
      negativeStyle: mars.negativeStyle,
      anchorTag: mars.anchor?.tag ?? null,
    })

    const outcomeFactorPrompt = await getOrSeedOutcomeFactorPrompt()
    const finalStyle = applyOutcomeFactorPrompt(
      musicProfessor.style,
      { tempoBpm: resolved.tempoBpm, mode: resolved.mode, mood: outcome.mood },
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
    // Each section carries an arc (its narrative job + space character); Bernie
    // renders them into a per-section brief. Structured fields mean no flavor
    // parentheticals leak into the lyric as backing vocals — the old
    // stripFlavorAnnotations dance is gone.
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

    // Professor pass — finishing editor that reads the post-Bernie lyric
    // through a tunable craft curriculum (specificity, inanimate agency,
    // scene continuity, etc.) and brings it to final standard. Runs BEFORE
    // arrangement injection so the curriculum sees raw lyric text without
    // the [Section | tag] noise. Internally falls back to the input lyric
    // if the hook is dropped, section markers go missing, or the API call
    // fails — the Professor must never block seed generation.
    const professor = await runProfessor({
      draftLyrics: lyricsRaw.lyrics,
      hookText: hook.text,
    })

    // Always run injectArrangement: even when arrangementSections is null, the
    // arranger performs the chorus-escalation pass (rename final [Chorus] to
    // [Final Chorus], add gang-vocal cues) so every track gets an energy arc.
    const arrangementPolicy = await getOrSeedArrangementPolicy()
    const finalLyrics = injectArrangement(professor.lyrics, arrangementSections ?? {}, arrangementPolicy.config)

    await prisma.songSeed.update({
      where: { id: songSeed.id },
      data: {
        status: 'queued',
        style: finalStyle,
        stylePortionRaw: mars.style,
        negativeStyle: musicProfessor.negativeStyle,
        vocalGender: mars.vocalGender,
        lyrics: finalLyrics,
        title: lyricsRaw.title,
        outcomeFactorPromptVersion: outcomeFactorPrompt.version,
        styleTemplateVersion: mars.styleTemplateVersion,
        lyricDraftPromptVersion: lyricsRaw.draftPromptVersion,
        professorPersonaVersion: professor.personaVersion,
        lyricPreProfessor: lyricsRaw.lyrics,
        professorChangeLog: professor.changeLog.length > 0 ? JSON.stringify(professor.changeLog) : null,
        musicProfessorPersonaVersion: musicProfessor.personaVersion,
        stylePreMusicProfessor: mars.style,
        negativeStylePreMusicProfessor: mars.negativeStyle,
        musicProfessorChangeLog: musicProfessor.changeLog.length > 0 ? JSON.stringify(musicProfessor.changeLog) : null,
        harmonicPalette: mars.harmonicPalette,
        vocalDescriptor: mars.vocalDescriptor,
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

/** Trim a string; return undefined for null / empty / whitespace-only. */
function nonEmpty(s: string | null | undefined): string | undefined {
  const t = s?.trim()
  return t ? t : undefined
}

// Read-time compatibility shim for v13 structured-field rows.
//
// v13 emits discrete columns (genreAnchor, harmonicCharacter, grooveCharacter, …) and
// leaves the legacy prose columns (vibePitch, harmonicAndGroove) null. The entire Mars
// subsystem — the anchor builder, the 5-axis exclusion haystack, and the DB-configured
// exclusion rules keyed on legacy field names — reads the prose columns. Rather than
// rewire every one of those consumers, we fill the legacy field names from the v13
// columns here, once, at the point a StyleAnalysis enters the seed builder. Pre-v13 rows
// (no v13 columns) are returned unchanged. extractGenreBrief and Mars's vocal-gender
// path read the discrete columns directly where it matters; this shim covers everything
// else for free.
export function normalizeStyleAnalysis<T extends StyleAnalysis>(sa: T): T {
  const out = { ...sa } as StyleAnalysis
  if (!nonEmpty(out.vibePitch) && nonEmpty(out.genreAnchor)) {
    out.vibePitch = out.genreAnchor
  }
  if (!nonEmpty(out.harmonicAndGroove)) {
    const h = nonEmpty(out.harmonicCharacter)
    const g = nonEmpty(out.grooveCharacter)
    if (h || g) out.harmonicAndGroove = [h, g].filter(Boolean).join(' | ')
  }
  return out as T
}

export function extractGenreBrief(
  styleAnalysis: StyleAnalysis,
  refTrackYear: number | null | undefined,
  anchorTag?: string | null,
): GenreBrief {
  // genreTag: Mars anchor (best signal) → v13 genre_anchor column → leading vibe_pitch
  // clause (pre-v13) → 'pop'.
  const genreTag = nonEmpty(anchorTag)
    ?? nonEmpty(styleAnalysis.genreAnchor)
    ?? extractLeadingGenre(styleAnalysis.vibePitch)
    ?? 'pop'

  // harmonic / groove: prefer the v13 discrete columns; else split the fused legacy field.
  let harmonicCharacter = nonEmpty(styleAnalysis.harmonicCharacter) ?? ''
  let grooveCharacter = nonEmpty(styleAnalysis.grooveCharacter) ?? ''
  if (!harmonicCharacter && !grooveCharacter) {
    const parts = splitHarmonicAndGroove(styleAnalysis.harmonicAndGroove ?? '')
    harmonicCharacter = parts.harmonic
    grooveCharacter = parts.groove
  }

  // vocalRegister: prefer the v13 column; else regex-scan vocal_character prose.
  const vocalRegister = nonEmpty(styleAnalysis.vocalRegister)
    ?? extractVocalRegister(styleAnalysis.vocalCharacter ?? '')

  const eraDecade = typeof refTrackYear === 'number'
    ? `${Math.floor(refTrackYear / 10) * 10}s`
    : ''

  return { genreTag, grooveCharacter, harmonicCharacter, vocalRegister, eraDecade }
}

function splitHarmonicAndGroove(text: string): { harmonic: string; groove: string } {
  const trimmed = text.trim()
  if (!trimmed) return { harmonic: '', groove: '' }
  // v13 normalization joins the two axes with " | "; split on that directly.
  if (trimmed.includes(' | ')) {
    const [harmonic, ...rest] = trimmed.split(' | ')
    return { harmonic: harmonic.trim(), groove: rest.join(' | ').trim() }
  }
  // Legacy fused prose: term-match groove vocabulary out of the comma fragments.
  const fragments = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
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

// Outcome → ref tempo gate. A ref is tempo-eligible for an outcome only when its
// decomposed BPM is within ±7 of the outcome's tempo. A NULL bpm means "tempo
// unknown" — it does NOT mean "matches every tempo". Unknown-tempo refs are
// benched from the matched pool. (This was the inverse before 2026-05-29: null
// returned `true`, so a single null-bpm decomposition was eligible for every
// outcome, always won the fast path, and starved lazy decomposition — one track
// pinned an entire batch. See schema/05-reference-track-decomposition.md
// "The BPM doctrine, restated".) To make a null-bpm ref usable, re-decompose it
// to resolve a real BPM (or set one manually); a still-null re-decompose stays
// benched rather than poisoning the pool.
//
// Tempo is the ONLY ref-track gate. Two former gates were removed (2026-05-23):
//   - Vocal gender: Hook.vocalGender drives Suno's vocal toggle directly in
//     populate-songs; the ref track's vocal lead is informational, not
//     steering. Filtering on it just narrowed the pool without changing
//     Suno's vocal output. Instrumental refs are also accepted now — Bernie
//     writes the lyrics, the ref is for stylistic anchoring only.
//   - Mode (major/minor): a song's mode isn't a single property — most songs
//     have chord progressions that mix major and minor chords. Inferring a
//     song-level mode from text was lossy and noisy. The outcome's mode
//     reaches Suno via the OutcomeFactorPrompt prepend; that's where mode
//     signaling belongs.
export const OUTCOME_TEMPO_TOLERANCE_BPM = 7
export function bpmCompatible(refBpm: number | null | undefined, outcomeTempoBpm: number): boolean {
  if (refBpm == null) return false
  return Math.abs(refBpm - outcomeTempoBpm) <= OUTCOME_TEMPO_TOLERANCE_BPM
}

export type PickRefResult =
  | { ok: true; ref: RefTrackWithAnalysis }
  | { ok: false; reason: 'no_approved_with_analysis' | 'no_outcome_tempo_match' }

// A failed or low-confidence decomposition produces a hallucinated genre tag and
// must not seed songs. The decomposer sets confidence:'low' exactly when it could
// not verify the track (the verifiable_facts grounding gate) — e.g. the "Puddle"
// case that returned vibe_pitch:"Unable to decompose…" yet still seeded a song.
// Such rows are excluded from picking AND from lazy re-decompose (a re-run would
// just fail again and burn a call).
export function isDecompositionUsable(confidence: string | null | undefined): boolean {
  return confidence !== 'low'
}

// useCount alone doesn't spread bursts: it only increments on operator accept
// (admin.ts), so every iteration of a burst sees the same snapshot. Add in-flight +
// accepted seed counts so each created seed pushes the next iteration toward a
// different track.
export function scoreTrack(t: { useCount: number; songSeeds: { status: string }[] }): number {
  const inFlight = t.songSeeds.filter(
    (s) => s.status === 'assembling' || s.status === 'queued' || s.status === 'accepted',
  ).length
  return t.useCount + inFlight
}

type PartitionTrack = { styleAnalysis: { bpm: number | null; confidence: string | null } | null }

// Split approved tracks into the pool that can be picked right now (decomposed,
// usable, tempo-compatible) vs. those that have never been decomposed and could be
// lazily decomposed on demand. Tracks that ARE decomposed but unusable or
// tempo-incompatible fall into neither bucket — they're skipped without re-decompose.
export function partitionPickableTracks<T extends PartitionTrack>(
  tracks: T[],
  outcomeTempoBpm: number,
): { ready: T[]; needsDecompose: T[] } {
  const ready: T[] = []
  const needsDecompose: T[] = []
  for (const t of tracks) {
    if (!t.styleAnalysis) {
      needsDecompose.push(t)
      continue
    }
    if (!isDecompositionUsable(t.styleAnalysis.confidence)) continue
    if (bpmCompatible(t.styleAnalysis.bpm, outcomeTempoBpm)) ready.push(t)
  }
  return { ready, needsDecompose }
}

// Per-pick budget on backfill decompositions. With bootstrap-eager decompose (see
// schema/05 "Decompose timing") the pool is already decomposed before generation, so
// the lazy path rarely runs at all; when it does it's a backfill for a straggler. A
// tempo-scarce pool could otherwise trigger a long chain of decompose calls for one
// seed; cap it. This is a safety bound on the backfill path, not a hot path.
export const MAX_LAZY_DECOMPOSE_PER_PICK = 4

// Pick a reference track for one seed.
//
// Decompose timing is bootstrap-eager (see schema/05 "Decompose timing"): the approved
// pool is decomposed BEFORE generation, so in the normal case the fast path below finds
// a populated, real-bpm `ready` set and spreads across it by score. The lazy path is a
// BACKFILL only — it covers an individual straggler bootstrap missed, not the primary
// way the pool gets decomposed. (The earlier lazy-primary "pay-as-you-go" model was
// withdrawn 2026-05-29: it made generation the first moment the pool got decomposed, so
// one early null-bpm decompose could pin a whole batch — the Root Down incident.)
//
// Fast path: if a decomposed, usable, tempo-compatible track exists, score and pick it
// (lowest score wins, random tiebreak). Lazy path: if none is ready, decompose
// never-decomposed candidates just-in-time (score order, bounded by
// MAX_LAZY_DECOMPOSE_PER_PICK) until one is usable and tempo-compatible. A null-bpm
// decomposition is NOT tempo-compatible (bpmCompatible(null) === false), so it can
// neither win the fast path nor be accepted by the lazy path — a single null-bpm track
// can no longer pin a batch.
export async function pickReferenceTrack(
  icpId: string,
  outcomeTempoBpm: number,
): Promise<PickRefResult> {
  const tracks = await prisma.referenceTrack.findMany({
    where: { icpId, status: 'approved' },
    include: {
      styleAnalysis: true,
      songSeeds: { select: { status: true } },
    },
  })
  if (tracks.length === 0) return { ok: false, reason: 'no_approved_with_analysis' }

  // Tiebreak randomly so single-seed runs also vary across calls.
  const rankByScore = <T extends { useCount: number; songSeeds: { status: string }[] }>(arr: T[]): T[] =>
    [...arr]
      .map((t) => ({ t, score: scoreTrack(t) }))
      .sort((a, b) => a.score - b.score || Math.random() - 0.5)
      .map((x) => x.t)

  const { ready, needsDecompose } = partitionPickableTracks(tracks, outcomeTempoBpm)

  // Fast path.
  const readyWinner = rankByScore(ready)[0]
  if (readyWinner?.styleAnalysis) {
    return { ok: true, ref: readyWinner as unknown as RefTrackWithAnalysis }
  }

  // Lazy path — decompose undecomposed candidates just-in-time.
  for (const t of rankByScore(needsDecompose).slice(0, MAX_LAZY_DECOMPOSE_PER_PICK)) {
    let sa
    try {
      const result = await decompose({
        artist: t.artist,
        title: t.title,
        year: t.year ?? undefined,
        operatorNotes: t.operatorNotes ?? undefined,
      })
      const data = toStyleAnalysisData(result)
      sa = await prisma.styleAnalysis.upsert({
        where: { referenceTrackId: t.id },
        create: { referenceTrackId: t.id, ...data },
        update: data,
      })
    } catch {
      // A decompose / API failure on one candidate must not abort the pick.
      continue
    }
    if (isDecompositionUsable(sa.confidence) && bpmCompatible(sa.bpm, outcomeTempoBpm)) {
      return { ok: true, ref: { ...t, styleAnalysis: sa } as unknown as RefTrackWithAnalysis }
    }
  }

  // Nothing usable + tempo-compatible, even after lazy decompose. Distinguish "had
  // usable decompositions but tempo mismatched" from "nothing to work with" for the caller.
  const anyUsableDecomposed = tracks.some(
    (t) => t.styleAnalysis && isDecompositionUsable(t.styleAnalysis.confidence),
  )
  return { ok: false, reason: anyUsableDecomposed ? 'no_outcome_tempo_match' : 'no_approved_with_analysis' }
}
