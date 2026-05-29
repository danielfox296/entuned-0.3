// Mars genre-keyed positive-style injections — harmonic palette + vocal identity.
//
// Two deterministic positive-style augmentations, both keyed off the same
// GenreGravityRule table. After Mars has assembled its genre/instrument/vocal-
// anchored style, these steps look up the song's anchor tag (or the assembled
// style itself, when no anchor is present) against the rule table.
//
// "Palette token" = harmonic vocabulary, e.g. "I-IV vamp", "tonic drone".
//   → ONE randomly-picked entry from positivePalettes, appended to style.
//
// "Vocal identity" = triple-stack vocal specification (character + delivery + effect).
//   → Composed from vocalCharacters × vocalDeliveries × vocalEffects arrays.
//   → Returned SEPARATELY — caller places it before the genre anchor in the
//     final style string, where Suno front-loads processing.
//   → Falls back to legacy vocalDescriptors if the triple-stack arrays are empty.
//
// Both injections are independent: a rule row may carry palettes, vocal components,
// both, or neither.

import { prisma } from '../../db.js'

export interface SteeringInjectionResult {
  /** The original style with harmonic palette appended (vocal identity is separate). */
  style: string
  /** The picked harmonic palette token, or null when no rule matched with palettes. */
  palette: string | null
  /** The composed triple-stack vocal identity string, or null when no rule matched. */
  vocalIdentity: string | null
  /** Legacy: the single vocal descriptor picked (for provenance on SongSeed). Null when triple-stack is used. */
  vocalDescriptor: string | null
  /** The tag of the rule that matched, for provenance. Null when no match. */
  matchedTag: string | null
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Compose a triple-stack vocal identity from the three component arrays.
// Format: "{character}, {delivery}, {effect}" — each component is one
// randomly-picked entry. Omits any layer whose array is empty.
function composeVocalIdentity(
  characters: string[],
  deliveries: string[],
  effects: string[],
): string | null {
  const parts: string[] = []
  if (characters.length > 0) parts.push(pickRandom(characters))
  if (deliveries.length > 0) parts.push(pickRandom(deliveries))
  if (effects.length > 0) parts.push(pickRandom(effects))
  return parts.length > 0 ? parts.join(', ') : null
}

export async function injectHarmonicPalette(
  style: string,
  anchorTag: string | null | undefined,
): Promise<SteeringInjectionResult> {
  const rules = await prisma.genreGravityRule.findMany({
    where: {
      active: true,
      OR: [
        { positivePalettes: { isEmpty: false } },
        { vocalDescriptors: { isEmpty: false } },
        { vocalCharacters: { isEmpty: false } },
        { vocalDeliveries: { isEmpty: false } },
        { vocalEffects: { isEmpty: false } },
      ],
    },
    select: {
      tag: true,
      positivePalettes: true,
      vocalDescriptors: true,
      vocalCharacters: true,
      vocalDeliveries: true,
      vocalEffects: true,
    },
  })

  if (rules.length === 0) {
    return { style, palette: null, vocalIdentity: null, vocalDescriptor: null, matchedTag: null }
  }

  const searchSpace = `${anchorTag ?? ''} ${style}`.toLowerCase()

  for (const rule of rules) {
    if (!searchSpace.includes(rule.tag.toLowerCase())) continue

    const palette = rule.positivePalettes.length > 0
      ? pickRandom(rule.positivePalettes)
      : null

    // Triple-stack takes precedence over legacy vocalDescriptors.
    const hasTripleStack = rule.vocalCharacters.length > 0
      || rule.vocalDeliveries.length > 0
      || rule.vocalEffects.length > 0

    let vocalIdentity: string | null = null
    let vocalDescriptor: string | null = null

    if (hasTripleStack) {
      vocalIdentity = composeVocalIdentity(
        rule.vocalCharacters,
        rule.vocalDeliveries,
        rule.vocalEffects,
      )
    } else if (rule.vocalDescriptors.length > 0) {
      vocalDescriptor = pickRandom(rule.vocalDescriptors)
    }

    // Only palette goes into the style string — vocal identity is placed
    // separately by the caller (before genre anchor, after outcome prepend).
    let outStyle = style
    if (palette) outStyle = `${outStyle}, ${palette}`

    return {
      style: outStyle,
      palette,
      vocalIdentity,
      vocalDescriptor,
      matchedTag: rule.tag,
    }
  }

  return { style, palette: null, vocalIdentity: null, vocalDescriptor: null, matchedTag: null }
}
