// Mars genre-keyed positive-style injections — harmonic palette + vocal descriptor.
//
// Two deterministic positive-style augmentations, both keyed off the same
// GenreGravityRule table. After Mars has assembled its genre/instrument/vocal-
// anchored style, these steps look up the song's anchor tag (or the assembled
// style itself, when no anchor is present) against the rule table. The first
// matching active rule contributes ONE randomly-picked entry from each of its
// `positivePalettes` and `vocalDescriptors` arrays, appended in order.
//
// "Palette token" = harmonic vocabulary, e.g. "I-IV vamp", "tonic drone".
// "Vocal descriptor" = performance trait, e.g. "drawl", "Irish lilt", "deadpan delivery".
// Both verified to bite text-only on Suno (2026-05-26 / 2026-05-26 testing).
//
// The two injections are independent: a rule row may carry palettes, descriptors,
// both, or neither (in which case it only does negative carving via Music
// Professor module 2).

import { prisma } from '../../db.js'

export interface SteeringInjectionResult {
  /** The original style with any matched tokens appended. */
  style: string
  /** The picked harmonic palette token, or null when no rule matched with palettes. */
  palette: string | null
  /** The picked vocal descriptor token, or null when no rule matched with descriptors. */
  vocalDescriptor: string | null
  /** The tag of the rule that matched, for provenance. Null when no match. */
  matchedTag: string | null
}

// Kept as the public name for backwards compat with existing import sites,
// even though we now also pick a vocal descriptor in the same pass.
export async function injectHarmonicPalette(
  style: string,
  anchorTag: string | null | undefined,
): Promise<SteeringInjectionResult> {
  // Load only rules that have SOMETHING to inject (either palette or descriptor).
  // Rules with both arrays empty are irrelevant to this step (their job is purely
  // negative via Music Professor module 2).
  const rules = await prisma.genreGravityRule.findMany({
    where: {
      active: true,
      OR: [
        { positivePalettes: { isEmpty: false } },
        { vocalDescriptors: { isEmpty: false } },
      ],
    },
    select: { tag: true, positivePalettes: true, vocalDescriptors: true },
  })

  if (rules.length === 0) {
    return { style, palette: null, vocalDescriptor: null, matchedTag: null }
  }

  const searchSpace = `${anchorTag ?? ''} ${style}`.toLowerCase()

  for (const rule of rules) {
    if (!searchSpace.includes(rule.tag.toLowerCase())) continue

    const palette = rule.positivePalettes.length > 0
      ? rule.positivePalettes[Math.floor(Math.random() * rule.positivePalettes.length)]
      : null
    const vocalDescriptor = rule.vocalDescriptors.length > 0
      ? rule.vocalDescriptors[Math.floor(Math.random() * rule.vocalDescriptors.length)]
      : null

    let outStyle = style
    if (palette) outStyle = `${outStyle}, ${palette}`
    if (vocalDescriptor) outStyle = `${outStyle}, ${vocalDescriptor}`

    return {
      style: outStyle,
      palette,
      vocalDescriptor,
      matchedTag: rule.tag,
    }
  }

  return { style, palette: null, vocalDescriptor: null, matchedTag: null }
}
