// Negative-style axis builder + always-fire contamination words.
//
// Two concerns rolled into one file because they both feed the same merged
// `negative_style` output that goes into Suno's "Exclude Styles" box:
//
//   1) ALWAYS_FIRE_CONTAMINATION — words Suno is documented to misread regardless
//      of context. The "live" family triggers crowd-recording artifacts; "acoustic"
//      pulls the arrangement toward acoustic guitar even when modifying a different
//      instrument. Merged unconditionally for every track.
//
//   2) MODERN_DRIFT_CONTAMINATION — `trap hats / autotune / sidechain pump` etc.
//      that Suno bleeds into non-modern-pop tracks because both register as
//      "modern". Fires by default; suppressed when the track is itself modern
//      pop / EDM / trap / hyperpop (where these elements are wanted).
//
//   3) buildAxisExclusions — given a StyleAnalysis, emits 1–3 opposites along
//      five axes: genre, instruments, vocals, mood/energy, production aesthetic.
//      Pragmatic first-cut lookup tables; should be tuned against generation
//      data over time.
//
// Overlap with DB-resident StyleExclusionRule rows is intentional. Code-resident
// always-fire and axis fragments back-stop the DB; a missing rule in the DB
// won't expose a track to known contamination. The downstream dedupe in
// style-exclusion-rules.ts strips duplicates from the merged output.
//
// Genre-family detection uses word-boundary regex (\b<term>\b) — substring
// matching produced false positives like "rock" matching "baroque" and "metal"
// matching "metallic guitar".

import type { StyleAnalysis } from '@prisma/client'

// ──────────────────────────────────────────────────────────────────────────────
// Always-fire contamination — Suno mis-triggers regardless of context.
// ──────────────────────────────────────────────────────────────────────────────

export const ALWAYS_FIRE_CONTAMINATION: readonly string[] = [
  // Confirmed live-recording triggers
  'live', 'arena', 'crowd', 'stadium',
  // Strongly suspected, same semantic family
  'concert', 'audience', 'unplugged', 'clapping', 'cheering', 'applause',
  'bootleg', 'recorded live', 'live performance', 'radio session',
] as const

// ──────────────────────────────────────────────────────────────────────────────
// Modern-drift contamination — fires UNLESS the track itself is modern-pop /
// EDM / trap / hyperpop, where these elements are wanted in the positive style.
// ──────────────────────────────────────────────────────────────────────────────

export const MODERN_DRIFT_CONTAMINATION: readonly string[] = [
  'trap hats', 'trap hi-hats', 'autotune', 'sidechain pump',
  'modern pop sheen', 'hyperpop edits',
] as const

const MODERN_FAMILY_TERMS: readonly string[] = [
  'hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'hyperpop',
  'edm', 'house', 'techno', 'dnb', 'drum and bass', 'dubstep', 'synthwave',
  'modern pop',
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
  // Use lookarounds so multi-word terms like "drum and bass" still anchor on
  // word boundaries at start and end without splitting the middle words.
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i')
}

function matchAnyBounded(haystack: string, terms: readonly string[]): boolean {
  return terms.some((t) => termToBoundedRegex(t).test(haystack))
}

// ──────────────────────────────────────────────────────────────────────────────
// Axis maps — opposites by genre family. `adjacentContamination` is gone;
// modern drift is now a single global set (above).
// ──────────────────────────────────────────────────────────────────────────────

interface GenreFamily {
  readonly id: string
  readonly match: readonly string[]
  readonly oppositeGenres: readonly string[]
  readonly oppositeInstruments: readonly string[]
}

const GENRE_FAMILIES: readonly GenreFamily[] = [
  {
    id: 'rock-metal',
    match: ['hard rock', 'arena rock', 'classic rock', 'garage rock', 'stoner rock', 'punk', 'metal', 'thrash metal', 'doom metal', 'rock'],
    oppositeGenres: ['acoustic ballad', 'orchestral', 'cinematic', 'synthwave', 'ambient'],
    oppositeInstruments: ['ukulele', 'harp', 'pan flute', 'soft piano', 'tropical steel drums'],
  },
  {
    id: 'country',
    match: ['country', 'americana', 'bluegrass', 'outlaw country', 'honky-tonk', 'heartland'],
    oppositeGenres: ['edm', 'industrial', 'drum and bass', 'trap', 'synthwave'],
    oppositeInstruments: ['808s', 'sub bass synth', 'distorted guitar', 'orchestral choir'],
  },
  {
    id: 'folk',
    match: ['indie folk', 'folk', 'singer-songwriter', 'acoustic folk'],
    oppositeGenres: ['edm', 'metal', 'trap', 'industrial', 'synthwave'],
    oppositeInstruments: ['808 kicks', 'distorted bass synth', 'thrash drums'],
  },
  {
    id: 'hip-hop',
    match: ['hip hop', 'hip-hop', 'rap', 'boom bap', 'trap', 'drill'],
    oppositeGenres: ['country', 'folk', 'orchestral', 'jazz fusion', 'bluegrass'],
    oppositeInstruments: ['fiddle', 'banjo', 'pedal steel', 'baroque harpsichord'],
  },
  {
    id: 'electronic',
    match: ['edm', 'house', 'techno', 'dnb', 'drum and bass', 'dubstep', 'electronic dance', 'synthwave'],
    oppositeGenres: ['country', 'folk', 'bluegrass', 'singer-songwriter', 'acoustic ballad'],
    oppositeInstruments: ['acoustic guitar', 'fiddle', 'pedal steel', 'banjo'],
  },
  {
    id: 'soul-jazz',
    match: ['neo-soul', 'r&b', 'rnb', 'soul', 'funk', 'jazz fusion', 'jazz'],
    oppositeGenres: ['thrash metal', 'screamo', 'industrial', 'hardcore'],
    oppositeInstruments: ['distorted guitar', 'double-kick drums', 'gang shouts'],
  },
  {
    id: 'ambient-classical',
    match: ['ambient', 'drone', 'cinematic', 'film score', 'orchestral', 'classical'],
    oppositeGenres: ['thrash metal', 'hardcore', 'trap', 'industrial', 'punk'],
    oppositeInstruments: ['distorted guitar', 'double-kick drums', '808s', 'gang vocals'],
  },
  {
    id: 'pop',
    match: ['pop', 'pop rock', 'modern pop'],
    oppositeGenres: ['drone', 'thrash metal', 'jazz fusion', 'doom metal'],
    oppositeInstruments: ['baroque harpsichord', 'tuba lead', 'distorted bass'],
  },
  {
    id: 'reggae',
    match: ['reggae', 'ska', 'dub'],
    oppositeGenres: ['thrash metal', 'industrial', 'edm hardstyle', 'orchestral'],
    oppositeInstruments: ['distorted guitar', 'orchestral choir'],
  },
  {
    id: 'blues',
    match: ['blues', 'delta blues', 'chicago blues'],
    oppositeGenres: ['edm', 'synthwave', 'trap', 'hyperpop'],
    oppositeInstruments: ['808s', 'sub bass synth', 'orchestral choir'],
  },
]

const VOCAL_OPPOSITES: ReadonlyArray<{ match: readonly string[]; opposites: readonly string[] }> = [
  {
    match: ['breathy', 'whispered', 'intimate', 'soft', 'tender', 'falsetto', 'airy'],
    opposites: ['aggressive male shout', 'screamed vocal', 'growled vocal', 'gang chant'],
  },
  {
    match: ['belted', 'shouted', 'aggressive', 'screamed', 'growled', 'gritty shout'],
    opposites: ['whispered vocal', 'breathy lullaby vocal', 'spoken-word ASMR'],
  },
  {
    match: ['smooth', 'polished', 'controlled', 'crooner', 'silky'],
    opposites: ['screamed vocal', 'unhinged vocal', 'distorted vocal'],
  },
]

const MOOD_OPPOSITES: ReadonlyArray<{ match: readonly string[]; opposites: readonly string[] }> = [
  {
    match: ['melancholy', 'somber', 'mournful', 'doleful', 'sad', 'plaintive', 'forlorn'],
    opposites: ['euphoric', 'party energy', 'celebratory uptempo'],
  },
  {
    match: ['uplifting', 'joyful', 'bright', 'sunny', 'celebratory', 'triumphant'],
    opposites: ['brooding', 'menacing', 'dirge tempo', 'funereal'],
  },
  {
    match: ['menacing', 'brooding', 'dark', 'sinister', 'ominous'],
    opposites: ['cheerful', 'sunny pop', 'wholesome lullaby'],
  },
  {
    match: ['energetic', 'driving', 'urgent', 'frantic', 'aggressive'],
    opposites: ['ambient drone', 'lullaby tempo', 'meditative'],
  },
  {
    match: ['tender', 'gentle', 'intimate', 'fragile'],
    opposites: ['stadium anthem', 'pummeling', 'aggressive shout'],
  },
]

const PRODUCTION_OPPOSITES: ReadonlyArray<{ match: readonly string[]; opposites: readonly string[] }> = [
  {
    match: ['lo-fi', 'cassette', 'tape hiss', 'home-recorded', 'demo', 'analog warmth', 'vintage'],
    opposites: ['hyperpolished modern digital', 'autotune sheen', 'maximalist mix'],
  },
  {
    match: ['polished', 'modern hi-fi', 'pristine', 'crisp digital', 'glossy'],
    opposites: ['lo-fi cassette', 'garage demo', 'phone-recorder fidelity'],
  },
  {
    match: ['dry', 'close-mic', 'minimal reverb'],
    opposites: ['cavernous reverb', 'wash of reverb'],
  },
  {
    match: ['cavernous', 'hall reverb', 'reverb-soaked', 'ambient wash'],
    opposites: ['dry close-mic', 'no reverb'],
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface AxisExclusionResult {
  /** Pre-dedupe list of fragments produced by axis matching + modern-drift. */
  fragments: string[]
  /** Tags identifying which axes fired, for provenance/debugging. */
  axesFired: string[]
  /** True if the track itself is in the modern-pop/EDM/trap family — the caller
   *  may use this to suppress modern-drift contamination if it adds it elsewhere. */
  isModernFamily: boolean
}

export function buildAxisExclusions(styleAnalysis: StyleAnalysis): AxisExclusionResult {
  const text = fieldText(styleAnalysis)
  const fragments: string[] = []
  const axesFired: string[] = []

  // Genre family → opposite genres + opposite instruments. First-match-wins to
  // avoid axis pollution when a ref carries multiple genre tags.
  for (const family of GENRE_FAMILIES) {
    if (matchAnyBounded(text, family.match)) {
      fragments.push(...family.oppositeGenres)
      fragments.push(...family.oppositeInstruments)
      axesFired.push(`genre:${family.id}`)
      break
    }
  }

  // Vocal-style opposites
  for (const v of VOCAL_OPPOSITES) {
    if (matchAnyBounded(text, v.match)) {
      fragments.push(...v.opposites)
      axesFired.push(`vocal:${v.match[0]}`)
      break
    }
  }

  // Mood / energy opposites
  for (const m of MOOD_OPPOSITES) {
    if (matchAnyBounded(text, m.match)) {
      fragments.push(...m.opposites)
      axesFired.push(`mood:${m.match[0]}`)
      break
    }
  }

  // Production-aesthetic opposites
  for (const p of PRODUCTION_OPPOSITES) {
    if (matchAnyBounded(text, p.match)) {
      fragments.push(...p.opposites)
      axesFired.push(`production:${p.match[0]}`)
      break
    }
  }

  // Modern drift — fires unless the track itself is in the modern family.
  const isModernFamily = matchAnyBounded(text, MODERN_FAMILY_TERMS)
  if (!isModernFamily) {
    fragments.push(...MODERN_DRIFT_CONTAMINATION)
    axesFired.push('modern-drift')
  }

  return { fragments, axesFired, isModernFamily }
}
