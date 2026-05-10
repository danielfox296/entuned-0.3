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

export interface FormArchetypeChoice {
  id: string | null  // null when falling back to LEGACY_DEFAULT (no DB row)
  slug: string
  displayName: string
  sectionList: string
  shapeNote: string
}

const LEGACY_DEFAULT: FormArchetypeChoice = {
  id: null,
  slug: 'vcvcbc',
  displayName: 'V-C-V-C-Bridge-Final C (legacy default)',
  sectionList: '[Intro] (optional), [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Final Chorus], [Outro] (optional)',
  shapeNote: 'Standard pop arc — two verse-chorus cycles, a bridge that contrasts in image or stance, then a final chorus that lands. The hook is the chorus, sung verbatim each time including in [Final Chorus].',
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
    const ow = (a.outcomeWeights as Record<string, unknown>) ?? {}
    const ew = (a.eraWeights as EraWeights | null) ?? null
    const weight = baseWeight(ow, input.outcomeKey) * eraMultiplier(ew, input.referenceYear)
    if (weight <= 0) continue
    scored.push({
      choice: {
        id: a.id,
        slug: a.slug,
        displayName: a.displayName,
        sectionList: a.sectionList,
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
