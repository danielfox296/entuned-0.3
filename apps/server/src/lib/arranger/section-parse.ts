// Shared section-matching primitives for the lyric pipeline.
//
// Extracted from arranger.ts (2026-05-29) so BOTH the Suno arranger
// (injectArrangement) and the Flow timeline builder (lib/flow/timeline.ts)
// derive section identity from the SAME logic. The matching contract — how a
// free-text `[Header]` maps onto a canonical SectionKey, how choruses are
// counted and ranked — is load-bearing and must never drift between engines.
//
// This module is PURE: no DB, no LLM, no env. The lyric text is the single
// source of truth for section sequence (Bernie is instructed to emit the form
// archetype's labels in order, but that's an LLM soft-contract — the only thing
// we can trust at this stage is the text in front of us).

export type SectionKey = 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'outro'

export interface SectionMatch {
  key: SectionKey
  /** The header literally said "final chorus" (vs. a chorus we infer is last). */
  explicitFinal: boolean
}

// Ordered regex table — order matters: `final chorus` is tested before `chorus`,
// `pre-chorus` before `chorus`, so the more specific label wins.
const SECTION_MAP: Array<[RegExp, SectionKey, boolean]> = [
  [/^intro/i, 'intro', false],
  [/^pre[\s-]?chorus/i, 'pre_chorus', false],
  [/^final[\s-]+chorus/i, 'chorus', true],
  [/^chorus/i, 'chorus', false],
  [/^verse/i, 'verse', false],
  [/^bridge/i, 'bridge', false],
  [/^outro/i, 'outro', false],
]

/** Map a `[Header]`'s inner text onto a canonical SectionKey, or null when the
 *  label is unrecognized (e.g. `[Hook]`, `[Break]`, `[Interlude]`). Callers must
 *  handle null by passing the section through untouched. */
export function normalizeSection(headerContent: string): SectionMatch | null {
  const trimmed = headerContent.trim()
  for (const [re, key, explicitFinal] of SECTION_MAP) {
    if (re.test(trimmed)) return { key, explicitFinal }
  }
  return null
}

export interface ChorusPlan {
  totalChoruses: number
  hasExplicitFinal: boolean
}

/** Count choruses and whether any is an explicit "Final Chorus". Used to decide
 *  the final-chorus position when no explicit final marker is present. */
export function planChoruses(lyrics: string): ChorusPlan {
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

/** The normalized key of the LAST section header in the (pre-injection) lyric, or
 *  null. `'unrecognized'` when the last header didn't map to a canonical key.
 *  Used to decide carry-out: a song that ends on a chorus needs an outro; one
 *  already ending on an outro/tag/bridge does not. */
export function lastSectionKey(lyrics: string): SectionKey | 'unrecognized' | null {
  let last: SectionKey | 'unrecognized' | null = null
  for (const line of lyrics.split('\n')) {
    const m = line.match(/^\[([^\]]+)\]$/)
    if (!m) continue
    const norm = normalizeSection(m[1])
    last = norm ? norm.key : 'unrecognized'
  }
  return last
}

export interface ChorusRank {
  /** 1-based index across all choruses in the song. */
  index: number
  isFinal: boolean
}

export interface LyricSectionBlock {
  /** The raw text inside the `[...]` header, e.g. "Verse 1", "Final Chorus", "Hook". */
  headerRaw: string
  /** Canonical key, or null when the header label is unrecognized. */
  key: SectionKey | null
  /** Header literally said "final chorus". */
  explicitFinal: boolean
  /** The non-empty lyric lines under this header, verbatim and in order. */
  lines: string[]
  /** Chorus rank (index + isFinal), present only on chorus blocks. */
  chorusRank?: ChorusRank
}

/** Parse a lyric string into ordered section blocks. The lyric text is the spine:
 *  each `[Header]` opens a block; subsequent non-empty lines are that block's
 *  lyric lines (blank lines and any pre-header preamble are dropped). Chorus
 *  blocks are annotated with their rank using the SAME final-chorus logic the
 *  arranger uses, so a Flow timeline gets the same energy arc as a Suno render.
 *
 *  Lyric lines are carried as data and never re-emitted by an LLM — this is the
 *  structural guarantee that the Flow renderer cannot corrupt a hook line. */
export function parseLyricSections(lyrics: string): LyricSectionBlock[] {
  const blocks: LyricSectionBlock[] = []
  for (const line of lyrics.split('\n')) {
    const headerMatch = line.match(/^\[([^\]]+)\]$/)
    if (headerMatch) {
      const norm = normalizeSection(headerMatch[1])
      blocks.push({
        headerRaw: headerMatch[1].trim(),
        key: norm ? norm.key : null,
        explicitFinal: norm?.explicitFinal ?? false,
        lines: [],
      })
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) continue // drop blank lines
    const current = blocks[blocks.length - 1]
    if (!current) continue // drop any preamble before the first header
    current.lines.push(line)
  }

  // Annotate chorus ranks positionally — mirror injectArrangement exactly:
  // explicit "Final Chorus" is final; otherwise the last chorus is final only
  // when there are ≥2 choruses and none was explicitly marked.
  const hasExplicitFinal = blocks.some((b) => b.key === 'chorus' && b.explicitFinal)
  const totalChoruses = blocks.filter((b) => b.key === 'chorus').length
  let chorusSeen = 0
  for (const b of blocks) {
    if (b.key !== 'chorus') continue
    chorusSeen++
    const isFinal =
      b.explicitFinal || (!hasExplicitFinal && chorusSeen === totalChoruses && totalChoruses >= 2)
    b.chorusRank = { index: chorusSeen, isFinal }
  }

  return blocks
}
