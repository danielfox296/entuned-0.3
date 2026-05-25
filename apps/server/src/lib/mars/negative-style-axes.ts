// Negative-style axis builder + always-fire contamination terms.
//
// Two concerns feed Mars's merged `negative_style` output:
//
//   1) ALWAYS_FIRE_CONTAMINATION — words Suno is documented to misread regardless
//      of context. The "live" family triggers crowd-recording artifacts; "acoustic"
//      pulls the arrangement toward acoustic guitar. Merged unconditionally.
//
//   2) MODERN_DRIFT_CONTAMINATION — `trap hats / autotune / sidechain pump` etc.
//      that Suno bleeds into non-modern-pop tracks because both register as
//      "modern". Fires by default; suppressed when the track is itself in the
//      modern family (modern pop / EDM / trap / hyperpop / etc.).
//
//   3) buildAxisExclusions — given a StyleAnalysis, emits 1–3 opposites along
//      five axes: genre, instruments (carried by the genre axis), vocals,
//      mood/energy, production aesthetic.
//
// DB-backed via `mars_contamination_terms` (categories: 'always_fire',
// 'modern_drift', 'modern_family') and `mars_axis_rules` (axisType: 'genre',
// 'vocal', 'mood', 'production'). Operators edit live in Dash → Prompts & Rules
// → Style Axes. The const seeds below are bootstrap-only — they populate the
// tables on cold-start and are never consulted at runtime once rows exist.
//
// Migrated from hardcoded `ALWAYS_FIRE_CONTAMINATION` / `MODERN_DRIFT_CONTAMINATION`
// / `GENRE_FAMILIES` / `VOCAL_OPPOSITES` / `MOOD_OPPOSITES` / `PRODUCTION_OPPOSITES`
// constants on 2026-05-25 per the no-prompt-content-in-code rule
// (see apps/server/CLAUDE.md Load-bearing rules).

import type { StyleAnalysis } from '@prisma/client'
import { prisma } from '../../db.js'

// ──────────────────────────────────────────────────────────────────────────────
// Seeds — cold-start only. Live data lives in DB; edit in Dash.
// ──────────────────────────────────────────────────────────────────────────────

export const ALWAYS_FIRE_CONTAMINATION_SEED: readonly string[] = [
  // Confirmed live-recording triggers
  'live', 'arena', 'crowd', 'stadium',
  // Strongly suspected, same semantic family
  'concert', 'audience', 'unplugged', 'clapping', 'cheering', 'applause',
  'bootleg', 'recorded live', 'live performance', 'radio session',
] as const

export const MODERN_DRIFT_CONTAMINATION_SEED: readonly string[] = [
  'trap hats', 'trap hi-hats', 'autotune', 'sidechain pump',
  'modern pop sheen', 'hyperpop edits',
] as const

export const MODERN_FAMILY_TERMS_SEED: readonly string[] = [
  'hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'hyperpop',
  'edm', 'house', 'techno', 'dnb', 'drum and bass', 'dubstep', 'synthwave',
  'modern pop',
] as const

interface SeedAxisRule {
  axisType: 'genre' | 'vocal' | 'mood' | 'production'
  label: string
  matchTerms: string[]
  opposites: string[]
  secondaryOpposites?: string[]
}

export const AXIS_RULES_SEED: readonly SeedAxisRule[] = [
  // Genre axis — first-match-wins; opposites = opposite genres, secondaryOpposites = opposite instruments.
  {
    axisType: 'genre',
    label: 'rock-metal',
    matchTerms: ['hard rock', 'arena rock', 'classic rock', 'garage rock', 'stoner rock', 'punk', 'metal', 'thrash metal', 'doom metal', 'rock'],
    opposites: ['acoustic ballad', 'orchestral', 'cinematic', 'synthwave', 'ambient'],
    secondaryOpposites: ['ukulele', 'harp', 'pan flute', 'soft piano', 'tropical steel drums'],
  },
  {
    axisType: 'genre',
    label: 'country',
    matchTerms: ['country', 'americana', 'bluegrass', 'outlaw country', 'honky-tonk', 'heartland'],
    opposites: ['edm', 'industrial', 'drum and bass', 'trap', 'synthwave'],
    secondaryOpposites: ['808s', 'sub bass synth', 'distorted guitar', 'orchestral choir'],
  },
  {
    axisType: 'genre',
    label: 'folk',
    matchTerms: ['indie folk', 'folk', 'singer-songwriter', 'acoustic folk'],
    opposites: ['edm', 'metal', 'trap', 'industrial', 'synthwave'],
    secondaryOpposites: ['808 kicks', 'distorted bass synth', 'thrash drums'],
  },
  {
    axisType: 'genre',
    label: 'hip-hop',
    matchTerms: ['hip hop', 'hip-hop', 'rap', 'boom bap', 'trap', 'drill'],
    opposites: ['country', 'folk', 'orchestral', 'jazz fusion', 'bluegrass'],
    secondaryOpposites: ['fiddle', 'banjo', 'pedal steel', 'baroque harpsichord'],
  },
  {
    axisType: 'genre',
    label: 'electronic',
    matchTerms: ['edm', 'house', 'techno', 'dnb', 'drum and bass', 'dubstep', 'electronic dance', 'synthwave'],
    opposites: ['country', 'folk', 'bluegrass', 'singer-songwriter', 'acoustic ballad'],
    secondaryOpposites: ['acoustic guitar', 'fiddle', 'pedal steel', 'banjo'],
  },
  {
    axisType: 'genre',
    label: 'soul-jazz',
    matchTerms: ['neo-soul', 'r&b', 'rnb', 'soul', 'funk', 'jazz fusion', 'jazz'],
    opposites: ['thrash metal', 'screamo', 'industrial', 'hardcore'],
    secondaryOpposites: ['distorted guitar', 'double-kick drums', 'gang shouts'],
  },
  {
    axisType: 'genre',
    label: 'ambient-classical',
    matchTerms: ['ambient', 'drone', 'cinematic', 'film score', 'orchestral', 'classical'],
    opposites: ['thrash metal', 'hardcore', 'trap', 'industrial', 'punk'],
    secondaryOpposites: ['distorted guitar', 'double-kick drums', '808s', 'gang vocals'],
  },
  {
    axisType: 'genre',
    label: 'pop',
    matchTerms: ['pop', 'pop rock', 'modern pop'],
    opposites: ['drone', 'thrash metal', 'jazz fusion', 'doom metal'],
    secondaryOpposites: ['baroque harpsichord', 'tuba lead', 'distorted bass'],
  },
  {
    axisType: 'genre',
    label: 'reggae',
    matchTerms: ['reggae', 'ska', 'dub'],
    opposites: ['thrash metal', 'industrial', 'edm hardstyle', 'orchestral'],
    secondaryOpposites: ['distorted guitar', 'orchestral choir'],
  },
  {
    axisType: 'genre',
    label: 'blues',
    matchTerms: ['blues', 'delta blues', 'chicago blues'],
    opposites: ['edm', 'synthwave', 'trap', 'hyperpop'],
    secondaryOpposites: ['808s', 'sub bass synth', 'orchestral choir'],
  },
  // Vocal axis
  {
    axisType: 'vocal',
    label: 'breathy',
    matchTerms: ['breathy', 'whispered', 'intimate', 'soft', 'tender', 'falsetto', 'airy'],
    opposites: ['aggressive male shout', 'screamed vocal', 'growled vocal', 'gang chant'],
  },
  {
    axisType: 'vocal',
    label: 'belted',
    matchTerms: ['belted', 'shouted', 'aggressive', 'screamed', 'growled', 'gritty shout'],
    opposites: ['whispered vocal', 'breathy lullaby vocal', 'spoken-word ASMR'],
  },
  {
    axisType: 'vocal',
    label: 'smooth',
    matchTerms: ['smooth', 'polished', 'controlled', 'crooner', 'silky'],
    opposites: ['screamed vocal', 'unhinged vocal', 'distorted vocal'],
  },
  // Mood axis
  {
    axisType: 'mood',
    label: 'melancholy',
    matchTerms: ['melancholy', 'somber', 'mournful', 'doleful', 'sad', 'plaintive', 'forlorn'],
    opposites: ['euphoric', 'party energy', 'celebratory uptempo'],
  },
  {
    axisType: 'mood',
    label: 'uplifting',
    matchTerms: ['uplifting', 'joyful', 'bright', 'sunny', 'celebratory', 'triumphant'],
    opposites: ['brooding', 'menacing', 'dirge tempo', 'funereal'],
  },
  {
    axisType: 'mood',
    label: 'menacing',
    matchTerms: ['menacing', 'brooding', 'dark', 'sinister', 'ominous'],
    opposites: ['cheerful', 'sunny pop', 'wholesome lullaby'],
  },
  {
    axisType: 'mood',
    label: 'energetic',
    matchTerms: ['energetic', 'driving', 'urgent', 'frantic', 'aggressive'],
    opposites: ['ambient drone', 'lullaby tempo', 'meditative'],
  },
  {
    axisType: 'mood',
    label: 'tender',
    matchTerms: ['tender', 'gentle', 'intimate', 'fragile'],
    opposites: ['stadium anthem', 'pummeling', 'aggressive shout'],
  },
  // Production axis
  {
    axisType: 'production',
    label: 'lo-fi',
    matchTerms: ['lo-fi', 'cassette', 'tape hiss', 'home-recorded', 'demo', 'analog warmth', 'vintage'],
    opposites: ['hyperpolished modern digital', 'autotune sheen', 'maximalist mix'],
  },
  {
    axisType: 'production',
    label: 'polished',
    matchTerms: ['polished', 'modern hi-fi', 'pristine', 'crisp digital', 'glossy'],
    opposites: ['lo-fi cassette', 'garage demo', 'phone-recorder fidelity'],
  },
  {
    axisType: 'production',
    label: 'dry',
    matchTerms: ['dry', 'close-mic', 'minimal reverb'],
    opposites: ['cavernous reverb', 'wash of reverb'],
  },
  {
    axisType: 'production',
    label: 'cavernous',
    matchTerms: ['cavernous', 'hall reverb', 'reverb-soaked', 'ambient wash'],
    opposites: ['dry close-mic', 'no reverb'],
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function fieldText(d: StyleAnalysis): string {
  return [
    d.vibePitch,
    (d as any).eraProductionSignature,
    (d as any).instrumentationPalette,
    (d as any).standoutElement,
    (d as any).vocalCharacter,
    (d as any).vocalArrangement,
    (d as any).harmonicAndGroove,
    (d as any).arrangementShape,
    (d as any).dynamicCurve,
  ]
    .filter((s): s is string => typeof s === 'string')
    .join(' · ')
    .toLowerCase()
}

/** Escape a term for use inside a `\b...\b` regex. Spaces are literalized;
 *  hyphens and other regex metacharacters are escaped. */
function termToBoundedRegex(term: string): RegExp {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i')
}

function matchAnyBounded(haystack: string, terms: readonly string[]): boolean {
  return terms.some((t) => termToBoundedRegex(t).test(haystack))
}

// ──────────────────────────────────────────────────────────────────────────────
// Cold-start seeding — populates the DB from the const seeds the first time
// the tables are observed empty. Idempotent + per-process gate.
// ──────────────────────────────────────────────────────────────────────────────

let seedAttempted = false
async function seedIfEmpty(): Promise<void> {
  if (seedAttempted) return
  seedAttempted = true

  const [contamCount, axisCount] = await Promise.all([
    prisma.marsContaminationTerm.count(),
    prisma.marsAxisRule.count(),
  ])

  if (contamCount === 0) {
    const rows: { category: string; term: string; sortOrder: number }[] = []
    ALWAYS_FIRE_CONTAMINATION_SEED.forEach((term, i) =>
      rows.push({ category: 'always_fire', term, sortOrder: i }))
    MODERN_DRIFT_CONTAMINATION_SEED.forEach((term, i) =>
      rows.push({ category: 'modern_drift', term, sortOrder: i }))
    MODERN_FAMILY_TERMS_SEED.forEach((term, i) =>
      rows.push({ category: 'modern_family', term, sortOrder: i }))
    if (rows.length > 0) {
      await prisma.marsContaminationTerm.createMany({ data: rows, skipDuplicates: true })
    }
  }

  if (axisCount === 0) {
    for (let i = 0; i < AXIS_RULES_SEED.length; i++) {
      const r = AXIS_RULES_SEED[i]
      await prisma.marsAxisRule.create({
        data: {
          axisType: r.axisType,
          label: r.label,
          matchTerms: r.matchTerms,
          opposites: r.opposites,
          secondaryOpposites: r.secondaryOpposites ?? [],
          sortOrder: i,
          notes: 'Auto-seeded from AXIS_RULES_SEED (cold-start).',
        },
      })
    }
  }
}

async function loadContamination(category: string): Promise<string[]> {
  await seedIfEmpty()
  const rows = await prisma.marsContaminationTerm.findMany({
    where: { category, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  return rows.map((r) => r.term)
}

interface LoadedAxisRule {
  axisType: string
  label: string
  matchTerms: string[]
  opposites: string[]
  secondaryOpposites: string[]
}

async function loadAxisRules(): Promise<LoadedAxisRule[]> {
  await seedIfEmpty()
  const rows = await prisma.marsAxisRule.findMany({
    where: { isActive: true },
    orderBy: [{ axisType: 'asc' }, { sortOrder: 'asc' }],
  })
  return rows.map((r) => ({
    axisType: r.axisType,
    label: r.label,
    matchTerms: r.matchTerms,
    opposites: r.opposites,
    secondaryOpposites: r.secondaryOpposites,
  }))
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export async function getAlwaysFireContamination(): Promise<string[]> {
  return loadContamination('always_fire')
}

export interface AxisExclusionResult {
  /** Pre-dedupe list of fragments produced by axis matching + modern-drift. */
  fragments: string[]
  /** Tags identifying which axes fired, for provenance/debugging. */
  axesFired: string[]
  /** True if the track itself is in the modern family — caller may use this to
   *  suppress modern-drift contamination if added elsewhere. */
  isModernFamily: boolean
}

export async function buildAxisExclusions(styleAnalysis: StyleAnalysis): Promise<AxisExclusionResult> {
  const text = fieldText(styleAnalysis)
  const fragments: string[] = []
  const axesFired: string[] = []

  const [axisRules, modernDrift, modernFamily] = await Promise.all([
    loadAxisRules(),
    loadContamination('modern_drift'),
    loadContamination('modern_family'),
  ])

  // First-match-wins within each axis type.
  for (const axisType of ['genre', 'vocal', 'mood', 'production'] as const) {
    const rulesForAxis = axisRules.filter((r) => r.axisType === axisType)
    for (const rule of rulesForAxis) {
      if (matchAnyBounded(text, rule.matchTerms)) {
        fragments.push(...rule.opposites)
        if (rule.secondaryOpposites.length > 0) fragments.push(...rule.secondaryOpposites)
        axesFired.push(`${axisType}:${rule.label}`)
        break
      }
    }
  }

  const isModernFamily = matchAnyBounded(text, modernFamily)
  if (!isModernFamily) {
    fragments.push(...modernDrift)
    axesFired.push('modern-drift')
  }

  return { fragments, axesFired, isModernFamily }
}
