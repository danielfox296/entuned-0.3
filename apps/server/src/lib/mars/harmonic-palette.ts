// Mars harmonic-palette injection.
//
// Deterministic positive-style augmentation. After Mars has assembled its
// genre/instrument/vocal-anchored style, this step looks up the song's
// anchor tag (or the assembled style itself, when no anchor is present)
// against the GenreGravityRule table. The first rule whose tag is a
// case-insensitive substring of the search space, AND which has a non-empty
// `positivePalettes` array, contributes ONE randomly-picked palette token
// appended to the positive style.
//
// "Palette token" is whatever string the operator typed into the rule —
// e.g. "I-IV vamp", "tonic drone", "iii-vi-ii-V-I cycle". Verified working:
// Suno responds to plain-English harmonic vocabulary in the style field
// (2026-05-26 test: I-IV vamp injected on outlaw country produced an audibly
// two-chord chorus).
//
// Independent of the negative-side carving the Music Professor's module 2
// applies (which reads counterExclusions from the same table). One rule
// row can supply either direction, both, or neither.

import { prisma } from '../../db.js'

export interface HarmonicPaletteResult {
  /** The original style with the palette token appended, or unchanged if no rule fired. */
  style: string
  /** The picked palette token, or null if no matching rule had any positivePalettes. */
  palette: string | null
  /** The tag of the rule that matched, for provenance. Null when no match. */
  matchedTag: string | null
}

export async function injectHarmonicPalette(
  style: string,
  anchorTag: string | null | undefined,
): Promise<HarmonicPaletteResult> {
  // Load only rules that have something to inject. A rule with empty
  // positivePalettes is irrelevant to this step (its job is purely negative).
  const rules = await prisma.genreGravityRule.findMany({
    where: { active: true, positivePalettes: { isEmpty: false } },
    select: { tag: true, positivePalettes: true },
  })

  if (rules.length === 0) {
    return { style, palette: null, matchedTag: null }
  }

  // Search space: anchor tag if present, plus the full style. The anchor tag
  // is the most reliable genre signal when set (anchor builder), but rules
  // should also match against the style for router / legacy builders.
  const searchSpace = `${anchorTag ?? ''} ${style}`.toLowerCase()

  // First rule whose tag substring-matches wins. Operators can control
  // ordering by writing tighter rules first (admin route orders by tag asc
  // by default; if multiple genres match a track, this is deterministic).
  for (const rule of rules) {
    if (searchSpace.includes(rule.tag.toLowerCase())) {
      const pick = rule.positivePalettes[Math.floor(Math.random() * rule.positivePalettes.length)]
      return {
        style: `${style}, ${pick}`,
        palette: pick,
        matchedTag: rule.tag,
      }
    }
  }

  return { style, palette: null, matchedTag: null }
}
