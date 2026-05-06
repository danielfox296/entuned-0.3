// Arranger — post-processes Bernie's lyrics to inject per-section production tags
// and apply chorus escalation across repeats.
//
// Two output formats are supported, gated by env var ARRANGER_FORMAT:
//
//   - 'legacy' (default) — the format we shipped before any external research.
//     Multi-line, one bracket per directive type:
//       [Chorus]
//       [Instrument: A, B]
//       [Sustained, full]
//       [Belted]
//
//   - 'pipe' — pipe-stacked single-bracket headers per external Suno research:
//       [Chorus | belted | sustained full | A and B]
//     Pipe acts as AND; max ~4 modifiers; broadest → most specific.
//
// The pipe format ships behind a flag so we can A/B against the legacy format
// before fully replacing the production output. Flip `ARRANGER_FORMAT=pipe` on
// Railway when ready to test.
//
// Chorus escalation runs for either format: identical chorus repetitions read as
// instructions to produce identical music, which flattens the song's energy arc.
// First chorus = base; middle chorus(es) layer in stacked harmonies; final chorus
// (whether labeled [Chorus] or [Final Chorus]) gets gang vocals on the hook,
// sustained-full energy. Bernie's lyric variation on [Final Chorus] is independent.
//
// Skipped when the base directive's vocal_delivery is `instrumental`, `wordless`,
// or `a-cappella` — escalation cues that mention "vocals" or "the hook" would
// contradict those base states.
//
// Pure function: no DB access, no LLM. Called in createSongSeed() after Bernie
// returns, before writing SongSeed.lyrics.

export interface SectionDirective {
  instruments: string[]
  density?: 'minimal' | 'sparse' | 'medium' | 'full'
  dynamic?: 'steady' | 'building' | 'dropping' | 'stripped' | 'erupting' | 'fade' | 'sustained' | 'retreating'
  vocal_delivery?: 'close-mic' | 'distant' | 'whispered' | 'belted' | 'falsetto' | 'stacked' | 'doubled' | 'wordless' | 'instrumental' | 'a-cappella'
}

export type ArrangementSections = Partial<Record<SectionKey, SectionDirective>>

type SectionKey = 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'outro'

type ArrangerFormat = 'legacy' | 'pipe'

function getFormat(): ArrangerFormat {
  const v = (process.env.ARRANGER_FORMAT ?? '').toLowerCase()
  return v === 'pipe' ? 'pipe' : 'legacy'
}

interface SectionMatch {
  key: SectionKey
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

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const ESCALATION_INCOMPATIBLE_DELIVERY = new Set(['instrumental', 'wordless', 'a-cappella'])

interface ChorusRank {
  index: number
  isFinal: boolean
}

interface EscalationApplied {
  delivery?: string
  density?: SectionDirective['density']
  dynamic?: SectionDirective['dynamic']
}

/** Compute escalated delivery/density/dynamic for the given chorus instance.
 *  Returns the original directive values when no escalation should apply (early
 *  chorus, or base delivery is instrumental/wordless/a-cappella). */
function applyChorusEscalation(
  directive: SectionDirective | undefined,
  rank: ChorusRank | undefined,
): EscalationApplied {
  const baseDelivery = directive?.vocal_delivery
  const baseDensity = directive?.density
  const baseDynamic = directive?.dynamic

  if (!rank) return { delivery: baseDelivery, density: baseDensity, dynamic: baseDynamic }

  // Skip escalation entirely when the base is incompatible — gang-vocal cues
  // would contradict an instrumental/wordless/a-cappella section.
  if (baseDelivery && ESCALATION_INCOMPATIBLE_DELIVERY.has(baseDelivery)) {
    return { delivery: baseDelivery, density: baseDensity, dynamic: baseDynamic }
  }

  let delivery: string | undefined = baseDelivery
  if (rank.isFinal) {
    delivery = delivery ? `${delivery}, gang vocals on the hook` : 'gang vocals on the hook'
  } else if (rank.index >= 2) {
    delivery = delivery ? `${delivery}, stacked harmonies` : 'stacked harmonies'
  }

  let density = baseDensity
  let dynamic = baseDynamic
  if (rank.isFinal) {
    if (!density || density === 'minimal' || density === 'sparse' || density === 'medium') density = 'full'
    if (!dynamic || dynamic === 'retreating' || dynamic === 'stripped' || dynamic === 'fade') dynamic = 'sustained'
  }

  return { delivery, density, dynamic }
}

interface ChorusPlan {
  totalChoruses: number
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

// ──────────────────────────────────────────────────────────────────────────────
// Format: legacy (multi-line tags)
// ──────────────────────────────────────────────────────────────────────────────

function buildLegacyTags(
  rawLabel: string,
  directive: SectionDirective | undefined,
  rank: ChorusRank | undefined,
): { headerLine: string; extraTags: string[] } {
  let label = rawLabel.trim()
  if (rank?.isFinal && !label.toLowerCase().includes('final')) label = 'Final Chorus'

  const esc = applyChorusEscalation(directive, rank)
  const tags: string[] = []

  if (directive && directive.instruments.length > 0) {
    tags.push(`[Instrument: ${directive.instruments.slice(0, 3).join(', ')}]`)
  }
  if (esc.dynamic) {
    tags.push(esc.density ? `[${titleCase(esc.dynamic)}, ${esc.density}]` : `[${titleCase(esc.dynamic)}]`)
  }
  if (esc.delivery) {
    // Legacy format uses a separate delivery bracket. Multi-word phrases like
    // "stacked harmonies" go in as-is.
    tags.push(`[${titleCase(esc.delivery)}]`)
  }
  return { headerLine: `[${label}]`, extraTags: tags }
}

// ──────────────────────────────────────────────────────────────────────────────
// Format: pipe-stacked single bracket
// ──────────────────────────────────────────────────────────────────────────────

function buildPipeHeader(
  rawLabel: string,
  directive: SectionDirective | undefined,
  rank: ChorusRank | undefined,
): string {
  let label = rawLabel.trim()
  if (rank?.isFinal && !label.toLowerCase().includes('final')) label = 'Final Chorus'

  const esc = applyChorusEscalation(directive, rank)
  const segments: string[] = []

  if (esc.delivery) segments.push(esc.delivery)

  const energy = [esc.dynamic, esc.density].filter(Boolean).join(' ').trim()
  if (energy) segments.push(energy)

  if (directive && directive.instruments.length > 0) {
    const instruments = directive.instruments.slice(0, 3)
    const phrase = instruments.length === 1
      ? instruments[0]
      : instruments.slice(0, -1).join(', ') + ' and ' + instruments[instruments.length - 1]
    segments.push(phrase)
  }

  if (segments.length === 0) return `[${label}]`
  return `[${label} | ${segments.join(' | ')}]`
}

// ──────────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────────

export function injectArrangement(lyrics: string, sections: ArrangementSections): string {
  // Always walk the lyrics — even with no directives, we still want the chorus
  // escalation pass to rename the final [Chorus] to [Final Chorus] and add
  // gang-vocal cues. That gives every track an energy arc regardless of whether
  // the reference's StyleAnalysis has arrangementSections.
  const plan = planChoruses(lyrics)
  const format = getFormat()
  let chorusSeen = 0

  return lyrics
    .split('\n')
    .flatMap((line) => {
      const headerMatch = line.match(/^\[([^\]]+)\]$/)
      if (!headerMatch) return [line]

      const norm = normalizeSection(headerMatch[1])
      if (!norm) return [line]

      const directive = sections[norm.key]
      let rank: ChorusRank | undefined

      if (norm.key === 'chorus') {
        chorusSeen++
        const isFinal =
          norm.explicitFinal ||
          (!plan.hasExplicitFinal && chorusSeen === plan.totalChoruses && plan.totalChoruses >= 2)
        rank = { index: chorusSeen, isFinal }
      }

      if (format === 'pipe') {
        return [buildPipeHeader(headerMatch[1], directive, rank)]
      }
      const { headerLine, extraTags } = buildLegacyTags(headerMatch[1], directive, rank)
      return [headerLine, ...extraTags]
    })
    .join('\n')
}
