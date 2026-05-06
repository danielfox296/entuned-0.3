// Arranger — post-processes Bernie's lyrics to inject per-section production tags.
//
// Suno reads pipe-stacked production cues inside a single bracketed header as a
// signal to bias the section toward those cues. Format:
//   [Verse 1 | close-mic | steady medium | acoustic guitar and brushed drums]
// Pipe `|` acts as AND. Order: section name first → broadest production direction →
// dynamic/density → instrument call. Max ~4 modifiers; more dilutes.
//
// Chorus escalation: identical chorus repetitions read as instructions to produce
// identical music, which flattens the song's energy arc. The arranger numbers the
// chorus instances it sees and escalates production cues across repeats: the first
// chorus is the base; the middle chorus(es) layer in stacked harmonies; the final
// chorus (whether labeled [Chorus] or [Final Chorus]) gets the biggest treatment —
// gang vocals on the hook, sustained density. Bernie's lyric variation (final-chorus
// non-hook line tweaks) is independent and orthogonal.
//
// This is a pure function: no DB access, no LLM. Called in createSongSeed() after
// Bernie returns, before writing SongSeed.lyrics.

export interface SectionDirective {
  instruments: string[]
  density?: 'minimal' | 'sparse' | 'medium' | 'full'
  // v8+: section-level energy character.
  dynamic?: 'steady' | 'building' | 'dropping' | 'stripped' | 'erupting' | 'fade' | 'sustained' | 'retreating'
  // v8+: section-level vocal staging.
  vocal_delivery?: 'close-mic' | 'distant' | 'whispered' | 'belted' | 'falsetto' | 'stacked' | 'doubled' | 'wordless' | 'instrumental' | 'a-cappella'
}

export type ArrangementSections = Partial<Record<SectionKey, SectionDirective>>

type SectionKey = 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'outro'

interface SectionMatch {
  key: SectionKey
  /** True if the original header explicitly used "Final Chorus" wording. */
  explicitFinal: boolean
}

const SECTION_MAP: Array<[RegExp, SectionKey, boolean]> = [
  [/^intro/i, 'intro', false],
  [/^pre[\s-]?chorus/i, 'pre_chorus', false],
  [/^final[\s-]+chorus/i, 'chorus', true],
  [/^chorus/i, 'chorus', false],
  [/^verse/i, 'verse', false],
  [/^bridge/i, 'bridge', false],
  [/^outro/i, 'outro', false],
]

function normalizeSection(headerContent: string): SectionMatch | null {
  const trimmed = headerContent.trim()
  for (const [re, key, explicitFinal] of SECTION_MAP) {
    if (re.test(trimmed)) return { key, explicitFinal }
  }
  return null
}

function dynamicWord(d: NonNullable<SectionDirective['dynamic']>): string {
  return d
}

function deliveryWord(v: NonNullable<SectionDirective['vocal_delivery']>): string {
  return v
}

interface BuildOpts {
  /** For chorus only: which instance (1-indexed) and whether it's the final one. */
  choruseRank?: { index: number; isFinal: boolean }
}

/**
 * Compose the bracketed header for a section. Returns the bracket *content* (the
 * part between [ and ]). The caller wraps it.
 *
 * Format: "<Label> | <delivery> | <dynamic> <density> | <instruments>"
 * Each pipe-segment is omitted when empty. Max 4 segments after the label.
 */
function buildHeaderContent(
  rawLabel: string,
  directive: SectionDirective | undefined,
  opts: BuildOpts = {},
): string {
  // Determine the label first. For final chorus, force the "Final Chorus" wording so
  // Suno reads it as a distinct, climactic section.
  let label = rawLabel.trim()
  if (opts.choruseRank?.isFinal) {
    label = label.toLowerCase().includes('final') ? label : 'Final Chorus'
  }

  const segments: string[] = []

  // Vocal delivery — escalate across choruses. Applies even without a directive so
  // the energy arc shows up on tracks that have no per-section arrangement metadata.
  let delivery: string | undefined = directive?.vocal_delivery ? deliveryWord(directive.vocal_delivery) : undefined
  if (opts.choruseRank) {
    const { index, isFinal } = opts.choruseRank
    if (isFinal) {
      delivery = delivery ? `${delivery}, gang vocals on the hook` : 'gang vocals on the hook'
    } else if (index >= 2) {
      delivery = delivery ? `${delivery}, stacked harmonies` : 'stacked harmonies'
    }
  }
  if (delivery) segments.push(delivery)

  // Dynamic + density — bumped on final chorus.
  let dynamic = directive?.dynamic ? dynamicWord(directive.dynamic) : undefined
  let density = directive?.density
  if (opts.choruseRank?.isFinal) {
    if (!density || density === 'minimal' || density === 'sparse' || density === 'medium') density = 'full'
    if (!dynamic || dynamic === 'retreating' || dynamic === 'stripped' || dynamic === 'fade') dynamic = 'sustained'
  }
  const energy = [dynamic, density].filter(Boolean).join(' ').trim()
  if (energy) segments.push(energy)

  // Instruments — capped at 3, only when a directive is present.
  if (directive && directive.instruments.length > 0) {
    const instruments = directive.instruments.slice(0, 3)
    const phrase = instruments.length === 1
      ? instruments[0]
      : instruments.slice(0, -1).join(', ') + ' and ' + instruments[instruments.length - 1]
    segments.push(phrase)
  }

  if (segments.length === 0) return label
  return `${label} | ${segments.join(' | ')}`
}

interface ChorusPlan {
  /** Total chorus instances in the lyric. Used to mark the last one as "final". */
  totalChoruses: number
  /** Whether any explicit [Final Chorus] header was found. */
  hasExplicitFinal: boolean
}

function planChoruses(lyrics: string): ChorusPlan {
  let total = 0
  let hasExplicitFinal = false
  for (const line of lyrics.split('\n')) {
    const m = line.match(/^\[([^\]]+)\]$/)
    if (!m) continue
    const norm = normalizeSection(m[1])
    if (!norm) continue
    if (norm.key === 'chorus') {
      total++
      if (norm.explicitFinal) hasExplicitFinal = true
    }
  }
  return { totalChoruses: total, hasExplicitFinal }
}

export function injectArrangement(lyrics: string, sections: ArrangementSections): string {
  // Even when no per-section arrangement directives are present, we still walk the
  // lyrics so the chorus-escalation pass can rename the final [Chorus] to
  // [Final Chorus] and add gang-vocal cues. This gives every track an energy arc
  // regardless of whether the reference's StyleAnalysis has arrangementSections.
  const plan = planChoruses(lyrics)
  let chorusSeen = 0

  return lyrics
    .split('\n')
    .map((line) => {
      const headerMatch = line.match(/^\[([^\]]+)\]$/)
      if (!headerMatch) return line

      const norm = normalizeSection(headerMatch[1])
      if (!norm) return line

      const directive = sections[norm.key]
      let opts: BuildOpts = {}

      if (norm.key === 'chorus') {
        chorusSeen++
        const isFinal =
          norm.explicitFinal ||
          (!plan.hasExplicitFinal && chorusSeen === plan.totalChoruses && plan.totalChoruses >= 2)
        opts = { choruseRank: { index: chorusSeen, isFinal } }
      }

      const content = buildHeaderContent(headerMatch[1], directive, opts)
      return `[${content}]`
    })
    .join('\n')
}
