// Arranger (a.k.a. Stager) — post-processes Bernie's lyrics to inject per-section
// production tags, apply chorus escalation across repeats, and carry the song out
// past a final chorus.
//
// Operator-tunable: the escalation cues + outro behavior live in the DB
// (ArrangementPolicy, edited in Dash → Engine → Arrangement Rules) and are passed
// in as an ArrangementConfig. This function stays PURE — no DB access, no LLM —
// so eno loads the policy and hands it in; tests pass a literal. The defaults
// (ARRANGEMENT_POLICY_SEED) reproduce the values that used to be hardcoded here.
//
// Two output formats, gated by env var ARRANGER_FORMAT:
//   - 'legacy' (default) — multi-line, one bracket per directive type.
//   - 'pipe' — pipe-stacked single-bracket headers ([Chorus | belted | full | A and B]).
//
// Chorus escalation: identical chorus repetitions read as "produce identical
// music," flattening the energy arc. First chorus = base; middle chorus(es) layer
// the mid cue; the final chorus gets the final cue + forced density/dynamic.
// Skipped when the base vocal_delivery is instrumental/wordless/a-cappella.
//
// Outro carry-out: when a song ends on a chorus with no outro/tag after it, append
// a sustained instrumental outro so Suno carries out instead of stopping cold.
// Forms that already end on an [Outro]/[Tag] (loop, tag_out) are left untouched.
//
// Called in createSongSeed() after Bernie returns, before writing SongSeed.lyrics.
//
// The section-matching primitives (SectionKey, normalizeSection, planChoruses,
// lastSectionKey, ChorusRank) live in ./section-parse.js and are shared with the
// Flow timeline builder so the two engines never disagree on section identity.

import {
  type SectionKey,
  type ChorusRank,
  normalizeSection,
  planChoruses,
  lastSectionKey,
} from './section-parse.js'

export interface SectionDirective {
  instruments: string[]
  density?: 'minimal' | 'sparse' | 'medium' | 'full'
  dynamic?: 'steady' | 'building' | 'dropping' | 'stripped' | 'erupting' | 'fade' | 'sustained' | 'retreating'
  vocal_delivery?: 'close-mic' | 'distant' | 'whispered' | 'belted' | 'falsetto' | 'stacked' | 'doubled' | 'wordless' | 'instrumental' | 'a-cappella'
}

export type ArrangementSections = Partial<Record<SectionKey, SectionDirective>>

// Operator-tunable Stager policy. Stored as JSON in ArrangementPolicy.config;
// seeded with ARRANGEMENT_POLICY_SEED (the formerly-hardcoded behavior).
export interface ArrangementConfig {
  finalChorus: { deliveryCue: string | null; forceDensity: string | null; forceDynamic: string | null }
  midChorus: { fromIndex: number; deliveryCue: string | null }
  outroOnChorusEnd: { enabled: boolean; label: string; density: string | null; dynamic: string | null; deliveryCue: string | null }
}

export const ARRANGEMENT_POLICY_SEED: ArrangementConfig = {
  finalChorus: { deliveryCue: 'gang vocals on the hook', forceDensity: 'full', forceDynamic: 'sustained' },
  midChorus: { fromIndex: 2, deliveryCue: 'stacked harmonies' },
  outroOnChorusEnd: { enabled: true, label: 'Outro', density: 'full', dynamic: 'sustained', deliveryCue: null },
}

type ArrangerFormat = 'legacy' | 'pipe'

function getFormat(): ArrangerFormat {
  const v = (process.env.ARRANGER_FORMAT ?? '').toLowerCase()
  return v === 'pipe' ? 'pipe' : 'legacy'
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const ESCALATION_INCOMPATIBLE_DELIVERY = new Set(['instrumental', 'wordless', 'a-cappella'])

interface EscalationApplied {
  delivery?: string
  density?: string
  dynamic?: string
}

/** Compute escalated delivery/density/dynamic for the given chorus instance,
 *  per the operator policy. Returns the original values when no escalation should
 *  apply (early chorus, or base delivery is instrumental/wordless/a-cappella). */
function applyChorusEscalation(
  directive: SectionDirective | undefined,
  rank: ChorusRank | undefined,
  policy: ArrangementConfig,
): EscalationApplied {
  const baseDelivery = directive?.vocal_delivery
  const baseDensity = directive?.density
  const baseDynamic = directive?.dynamic

  if (!rank) return { delivery: baseDelivery, density: baseDensity, dynamic: baseDynamic }

  // Skip escalation entirely when the base is incompatible — vocal cues would
  // contradict an instrumental/wordless/a-cappella section.
  if (baseDelivery && ESCALATION_INCOMPATIBLE_DELIVERY.has(baseDelivery)) {
    return { delivery: baseDelivery, density: baseDensity, dynamic: baseDynamic }
  }

  let delivery: string | undefined = baseDelivery
  if (rank.isFinal) {
    const cue = policy.finalChorus.deliveryCue
    if (cue) delivery = delivery ? `${delivery}, ${cue}` : cue
  } else if (rank.index >= policy.midChorus.fromIndex) {
    const cue = policy.midChorus.deliveryCue
    if (cue) delivery = delivery ? `${delivery}, ${cue}` : cue
  }

  let density: string | undefined = baseDensity
  let dynamic: string | undefined = baseDynamic
  if (rank.isFinal) {
    const fd = policy.finalChorus.forceDensity
    const fdyn = policy.finalChorus.forceDynamic
    if (fd && (!density || density === 'minimal' || density === 'sparse' || density === 'medium')) density = fd
    if (fdyn && (!dynamic || dynamic === 'retreating' || dynamic === 'stripped' || dynamic === 'fade')) dynamic = fdyn
  }

  return { delivery, density, dynamic }
}

/** Build the appended instrumental outro lines for the active format. */
function buildOutroBlock(policy: ArrangementConfig, format: ArrangerFormat): string[] {
  const o = policy.outroOnChorusEnd
  if (format === 'pipe') {
    const segments: string[] = []
    if (o.deliveryCue) segments.push(o.deliveryCue)
    const energy = [o.dynamic, o.density].filter(Boolean).join(' ').trim()
    if (energy) segments.push(energy)
    return ['', segments.length ? `[${o.label} | ${segments.join(' | ')}]` : `[${o.label}]`]
  }
  const lines = ['', `[${o.label}]`]
  if (o.dynamic) lines.push(o.density ? `[${titleCase(o.dynamic)}, ${o.density}]` : `[${titleCase(o.dynamic)}]`)
  if (o.deliveryCue) lines.push(`[${titleCase(o.deliveryCue)}]`)
  return lines
}

// ──────────────────────────────────────────────────────────────────────────────
// Format: legacy (multi-line tags)
// ──────────────────────────────────────────────────────────────────────────────

function buildLegacyTags(
  rawLabel: string,
  directive: SectionDirective | undefined,
  rank: ChorusRank | undefined,
  policy: ArrangementConfig,
): { headerLine: string; extraTags: string[] } {
  let label = rawLabel.trim()
  if (rank?.isFinal && !label.toLowerCase().includes('final')) label = 'Final Chorus'

  const esc = applyChorusEscalation(directive, rank, policy)
  const tags: string[] = []

  if (directive && directive.instruments.length > 0) {
    tags.push(`[Instrument: ${directive.instruments.slice(0, 3).join(', ')}]`)
  }
  if (esc.dynamic) {
    tags.push(esc.density ? `[${titleCase(esc.dynamic)}, ${esc.density}]` : `[${titleCase(esc.dynamic)}]`)
  }
  if (esc.delivery) {
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
  policy: ArrangementConfig,
): string {
  let label = rawLabel.trim()
  if (rank?.isFinal && !label.toLowerCase().includes('final')) label = 'Final Chorus'

  const esc = applyChorusEscalation(directive, rank, policy)
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

export function injectArrangement(
  lyrics: string,
  sections: ArrangementSections,
  policy: ArrangementConfig = ARRANGEMENT_POLICY_SEED,
): string {
  // Always walk the lyrics — even with no directives, the chorus-escalation pass
  // renames the final [Chorus] to [Final Chorus] and adds the final cue, giving
  // every track an energy arc regardless of the reference's StyleAnalysis.
  const plan = planChoruses(lyrics)
  const format = getFormat()
  const endsOnChorus = lastSectionKey(lyrics) === 'chorus'
  let chorusSeen = 0

  const lines = lyrics
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
        return [buildPipeHeader(headerMatch[1], directive, rank, policy)]
      }
      const { headerLine, extraTags } = buildLegacyTags(headerMatch[1], directive, rank, policy)
      return [headerLine, ...extraTags]
    })

  // Carry-out: a song that ends on a chorus stops cold. Append a sustained
  // instrumental outro so it lands. Forms ending on an [Outro]/[Tag]/bridge are
  // left alone (lastSectionKey !== 'chorus').
  if (policy.outroOnChorusEnd?.enabled && endsOnChorus) {
    lines.push(...buildOutroBlock(policy, format))
  }

  return lines.join('\n')
}
