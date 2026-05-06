// Negative-style axis builder + always-fire contamination words.
//
// Two concerns rolled into one file because they both feed the same merged
// `negative_style` output that goes into Suno's "Exclude Styles" box:
//
//   1) ALWAYS_FIRE_CONTAMINATION — words Suno is documented to misread regardless
//      of context. The "live" family triggers crowd-recording artifacts; "acoustic"
//      pulls the arrangement toward acoustic guitar even when modifying a different
//      instrument. These are merged unconditionally into negative_style for every
//      track. They are also stripped from the positive style by Mars's sanitizer.
//
//   2) buildAxisExclusions — given a StyleAnalysis, emits 1–3 opposites along five
//      axes (genre, instruments, vocals, mood/energy, production aesthetic) plus a
//      sixth "genre-adjacent contamination" axis that names elements Suno tends to
//      bleed in from related genres (e.g. trap hi-hats appearing inside rock songs
//      because both register as "modern"). The framework comes from external Suno
//      research; the per-axis lookup tables are pragmatic first-cut maps that
//      should be tuned against generation data over time.
//
// Both outputs flow through the same dedupe step downstream. Order is not
// guaranteed; the merged exclude string is comma-joined.

import type { StyleAnalysis } from '@prisma/client'

// ──────────────────────────────────────────────────────────────────────────────
// Always-fire contamination words.
// ──────────────────────────────────────────────────────────────────────────────

/** Words that produce undesired Suno artifacts regardless of intent. Always merged
 *  into negative_style. Confirmed live-recording triggers + strongly suspected
 *  same-family terms + the documented `acoustic` instrument trigger. */
export const ALWAYS_FIRE_CONTAMINATION: readonly string[] = [
  // Confirmed live-recording triggers
  'live',
  'arena',
  'crowd',
  'stadium',
  // Strongly suspected, same semantic family
  'concert',
  'audience',
  'unplugged',
  'clapping',
  'cheering',
  'applause',
  'bootleg',
  'recorded live',
  'live performance',
  'radio session',
] as const

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function fieldText(d: StyleAnalysis): string {
  // Concatenate every text field on the StyleAnalysis. Not all of these exist on
  // every analysis; missing fields are simply skipped by the optional chain.
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

function matchAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n))
}

// ──────────────────────────────────────────────────────────────────────────────
// Axis maps
// ──────────────────────────────────────────────────────────────────────────────

interface GenreFamily {
  /** Substrings that identify this family in any text field. */
  match: readonly string[]
  /** Opposite genres (axis 1). */
  oppositeGenres: readonly string[]
  /** Opposite instruments (axis 2). */
  oppositeInstruments: readonly string[]
  /** Genre-adjacent contamination — things Suno bleeds in from neighboring genres (axis 6). */
  adjacentContamination: readonly string[]
}

const GENRE_FAMILIES: readonly GenreFamily[] = [
  {
    match: ['hard rock', 'arena rock', 'classic rock', 'garage rock', 'stoner rock', 'punk', 'metal', 'thrash', 'doom'],
    oppositeGenres: ['acoustic ballad', 'orchestral', 'cinematic', 'synthwave', 'ambient'],
    oppositeInstruments: ['ukulele', 'harp', 'pan flute', 'soft piano', 'tropical steel drums'],
    adjacentContamination: ['trap hats', 'autotune', 'edm drops'],
  },
  {
    match: ['country', 'americana', 'bluegrass', 'outlaw country', 'honky-tonk', 'heartland'],
    oppositeGenres: ['edm', 'industrial', 'drum and bass', 'trap', 'synthwave'],
    oppositeInstruments: ['808s', 'sub bass synth', 'distorted guitar', 'orchestral choir'],
    adjacentContamination: ['trap hi-hats', 'autotune', 'sidechain pump'],
  },
  {
    match: ['indie folk', 'folk', 'singer-songwriter', 'acoustic folk'],
    oppositeGenres: ['edm', 'metal', 'trap', 'industrial', 'synthwave'],
    oppositeInstruments: ['808 kicks', 'distorted bass synth', 'thrash drums'],
    adjacentContamination: ['trap hats', 'autotune', 'modern pop sheen'],
  },
  {
    match: ['hip hop', 'hip-hop', 'rap', 'boom bap', 'trap', 'drill'],
    oppositeGenres: ['country', 'folk', 'orchestral', 'jazz fusion', 'bluegrass'],
    oppositeInstruments: ['fiddle', 'banjo', 'pedal steel', 'baroque harpsichord'],
    adjacentContamination: ['rock guitars', 'singer-songwriter strum', 'pop ballad piano'],
  },
  {
    match: ['edm', 'house', 'techno', 'dnb', 'drum and bass', 'dubstep', 'electronic dance', 'synthwave'],
    oppositeGenres: ['country', 'folk', 'bluegrass', 'singer-songwriter', 'acoustic ballad'],
    oppositeInstruments: ['acoustic guitar', 'fiddle', 'pedal steel', 'banjo'],
    adjacentContamination: ['trap hats', 'pop ballad piano', 'modern country drums'],
  },
  {
    match: ['neo-soul', 'r&b', 'rnb', 'soul', 'funk', 'jazz fusion', 'jazz'],
    oppositeGenres: ['thrash metal', 'screamo', 'industrial', 'hardcore'],
    oppositeInstruments: ['distorted guitar', 'double-kick drums', 'gang shouts'],
    adjacentContamination: ['trap hats', 'autotune', 'pop sheen'],
  },
  {
    match: ['ambient', 'drone', 'cinematic', 'film score', 'orchestral', 'classical'],
    oppositeGenres: ['thrash metal', 'hardcore', 'trap', 'industrial', 'punk'],
    oppositeInstruments: ['distorted guitar', 'double-kick drums', '808s', 'gang vocals'],
    adjacentContamination: ['trap hats', 'autotune'],
  },
  {
    match: ['pop', 'pop rock', 'modern pop'],
    oppositeGenres: ['drone', 'thrash metal', 'jazz fusion', 'doom metal'],
    oppositeInstruments: ['baroque harpsichord', 'tuba lead', 'distorted bass'],
    adjacentContamination: ['trap hats', 'autotune'],
  },
  {
    match: ['reggae', 'ska', 'dub'],
    oppositeGenres: ['thrash metal', 'industrial', 'edm hardstyle', 'orchestral'],
    oppositeInstruments: ['distorted guitar', 'orchestral choir'],
    adjacentContamination: ['trap hats', 'autotune'],
  },
  {
    match: ['blues', 'delta blues', 'chicago blues'],
    oppositeGenres: ['edm', 'synthwave', 'trap', 'hyperpop'],
    oppositeInstruments: ['808s', 'sub bass synth', 'orchestral choir'],
    adjacentContamination: ['trap hats', 'autotune'],
  },
]

const VOCAL_OPPOSITES: ReadonlyArray<{ match: readonly string[]; opposites: readonly string[] }> = [
  // Soft / breathy → opposite: aggressive shouted / growled
  {
    match: ['breathy', 'whispered', 'intimate', 'soft', 'tender', 'falsetto', 'airy'],
    opposites: ['aggressive male shout', 'screamed vocal', 'growled vocal', 'gang chant'],
  },
  // Aggressive / belted / shouted → opposite: whispered / breathy
  {
    match: ['belted', 'shouted', 'aggressive', 'screamed', 'growled', 'gritty shout'],
    opposites: ['whispered vocal', 'breathy lullaby vocal', 'spoken-word ASMR'],
  },
  // Smooth / polished → opposite: lo-fi / unhinged
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
  /** Pre-dedupe list of fragments produced by axis matching. */
  fragments: string[]
  /** Tags identifying which axes fired, for provenance/debugging. */
  axesFired: string[]
}

/** Build axis-based exclusion fragments from a StyleAnalysis. Pure function. */
export function buildAxisExclusions(styleAnalysis: StyleAnalysis): AxisExclusionResult {
  const text = fieldText(styleAnalysis)
  const fragments: string[] = []
  const axesFired: string[] = []

  // Axis 1+2+6: genre family → opposite genres, opposite instruments, adjacent contamination
  for (const family of GENRE_FAMILIES) {
    if (matchAny(text, family.match)) {
      fragments.push(...family.oppositeGenres)
      fragments.push(...family.oppositeInstruments)
      fragments.push(...family.adjacentContamination)
      axesFired.push(`genre:${family.match[0]}`, 'instruments', 'adjacent')
      break // only fire the first-matching family — avoids axis pollution from multi-tag refs
    }
  }

  // Axis 3: vocal style opposites
  for (const v of VOCAL_OPPOSITES) {
    if (matchAny(text, v.match)) {
      fragments.push(...v.opposites)
      axesFired.push(`vocal:${v.match[0]}`)
      break
    }
  }

  // Axis 4: mood / energy opposites
  for (const m of MOOD_OPPOSITES) {
    if (matchAny(text, m.match)) {
      fragments.push(...m.opposites)
      axesFired.push(`mood:${m.match[0]}`)
      break
    }
  }

  // Axis 5: production aesthetic opposites
  for (const p of PRODUCTION_OPPOSITES) {
    if (matchAny(text, p.match)) {
      fragments.push(...p.opposites)
      axesFired.push(`production:${p.match[0]}`)
      break
    }
  }

  return { fragments, axesFired }
}
