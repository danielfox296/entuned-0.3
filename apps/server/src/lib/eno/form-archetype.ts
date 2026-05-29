// Form archetype selector. Eno calls pickFormArchetype() per generation to choose
// a song-form (VCVCBC, AABA, VCVC, intro-driven, loop, tag-out, ...) before Bernie
// runs. Replaces the hardcoded V/C/V/C/Bridge/Final-C shape that used to live in
// Bernie's draft prompt and made every song arrangement-similar.
//
// Selection algorithm:
//   1. Load active archetypes from DB.
//   2. Filter by requiresSections ⊆ keys(arrangementSections) — no constraint when
//      arrangementSections is null/empty (treat all as eligible).
//   3. Compute weight per archetype:
//        base = outcomeWeights[outcomeKey] ?? outcomeWeights["*"] ?? 1
//        eraMultiplier = eraWeights null → 1; otherwise sum of weights of every
//          range that contains the ref track's year (0 if no range matches)
//        weight = base * eraMultiplier
//   4. Drop zero-weight archetypes. Weighted-random pick.
//   5. If nothing qualifies (empty DB, all filtered out, all zero), return the
//      legacy default — same shape as the old hardcoded prompt — so generation
//      never fails on archetype selection.

import { prisma } from '../../db.js'
import type { ArrangementSections } from '../arranger/arranger.js'

// One section of a song form. Ordered per-occurrence (Verse 1 and Verse 2 are
// separate entries with separate arcs). `label` is the bare section name
// ("Verse 1"); brackets are added when rendering to Bernie. `arc` is the
// stanza's intention — what it does + its relationship to the hook + its
// space/density character. Plain English; Bernie reads it directly.
export interface SectionSpec {
  label: string
  optional?: boolean
  arc: string
}

export interface FormArchetypeChoice {
  id: string | null  // null when falling back to LEGACY_DEFAULT (no DB row)
  slug: string
  displayName: string
  sections: SectionSpec[]
  shapeNote: string
}

const LEGACY_DEFAULT: FormArchetypeChoice = {
  id: null,
  slug: 'vcvcbc',
  displayName: 'V-C-V-C-Bridge-Final C (legacy default)',
  sections: [
    { label: 'Intro', optional: true, arc: 'The Frame — near-wordless. If any words, one short phrase that hints at the hook’s world. Leave most of it to the music.' },
    { label: 'Verse 1', arc: 'Establish-and-Lean — set one plain scene with the narrator acting. End leaning toward the chorus. Leave a line short.' },
    { label: 'Pre-Chorus', optional: true, arc: 'The Lift — tighten and rise, short pushing lines, energy aimed at the chorus. End unresolved.' },
    { label: 'Chorus', arc: 'Thesis — state the song’s one idea, clean and finished. Plain words, room around it. Say it and let it ring. Hook verbatim.' },
    { label: 'Verse 2', arc: 'The Turn — don’t restate Verse 1; later moment or harder truth. Make the hook mean something new when it returns. Stay bare.' },
    { label: 'Pre-Chorus', optional: true, arc: 'The Lift — same rise as before, a touch more pressure. End unresolved.' },
    { label: 'Chorus', arc: 'Thesis — hook verbatim again. Same words, now carrying Verse 2’s weight.' },
    { label: 'Bridge', arc: 'Reframe — step outside the frame: new image, new stance, the line the verses avoided. Barest section. Resolve back toward the hook.' },
    { label: 'Final Chorus', arc: 'Thesis-Plus — same hook, heaviest landing. Identical words, earned. No new lines.' },
    { label: 'Outro', optional: true, arc: 'The Landing — hook fragment, sustained, like the last thing said before the lights go. No new ideas.' },
  ],
  shapeNote: 'Standard pop arc — two verse-chorus cycles, a bridge that contrasts in image or stance, then a final chorus that lands. The hook is the chorus, sung verbatim each time including in the Final Chorus.',
}

interface EraRange {
  minYear?: number
  maxYear?: number
  weight: number
}

interface EraWeights {
  ranges?: EraRange[]
}

function eraMultiplier(eraWeights: EraWeights | null | undefined, year: number | null | undefined): number {
  if (!eraWeights || !eraWeights.ranges || eraWeights.ranges.length === 0) return 1
  if (year == null) return 0  // archetype gates on era but ref track has no year — skip it
  let total = 0
  for (const r of eraWeights.ranges) {
    const minOk = r.minYear == null || year >= r.minYear
    const maxOk = r.maxYear == null || year <= r.maxYear
    if (minOk && maxOk) total += r.weight
  }
  return total
}

function baseWeight(outcomeWeights: Record<string, unknown>, outcomeKey: string): number {
  const w = outcomeWeights[outcomeKey] ?? outcomeWeights['*']
  if (typeof w === 'number' && Number.isFinite(w) && w >= 0) return w
  return 1
}

export interface PickInput {
  outcomeKey: string
  arrangementSections: ArrangementSections | null | undefined
  referenceYear: number | null | undefined
}

export async function pickFormArchetype(input: PickInput): Promise<FormArchetypeChoice> {
  const archetypes = await prisma.formArchetype.findMany({ where: { isActive: true } })
  if (archetypes.length === 0) return LEGACY_DEFAULT

  const presentSections = new Set(
    input.arrangementSections ? Object.keys(input.arrangementSections) : [],
  )
  const skipSectionFilter = presentSections.size === 0

  const scored: Array<{ choice: FormArchetypeChoice; weight: number }> = []
  for (const a of archetypes) {
    if (!skipSectionFilter) {
      const hasAllRequired = a.requiresSections.every((s) => presentSections.has(s))
      if (!hasAllRequired) continue
    }
    // A form with no sections can't shape a lyric. Skip it (handles the brief
    // window between the section_list→sections migration and the re-seed).
    const sections = Array.isArray(a.sections) ? (a.sections as unknown as SectionSpec[]) : []
    if (sections.length === 0) continue
    const ow = (a.outcomeWeights as Record<string, unknown>) ?? {}
    const ew = (a.eraWeights as EraWeights | null) ?? null
    const weight = baseWeight(ow, input.outcomeKey) * eraMultiplier(ew, input.referenceYear)
    if (weight <= 0) continue
    scored.push({
      choice: {
        id: a.id,
        slug: a.slug,
        displayName: a.displayName,
        sections,
        shapeNote: a.shapeNote,
      },
      weight,
    })
  }

  if (scored.length === 0) return LEGACY_DEFAULT

  const total = scored.reduce((s, x) => s + x.weight, 0)
  let r = Math.random() * total
  for (const s of scored) {
    r -= s.weight
    if (r <= 0) return s.choice
  }
  return scored[scored.length - 1]!.choice
}
