// Mars StyleTemplate v1 — deterministic. Composes a Decomposition into a Suno-ready
// style portion.
//
// Locked 2026-04-25 after first Suno reality check:
//   - Outcome is OUT of the style prompt entirely. Outcome's tempo/mode/dynamics are
//     set on Suno's other params, not in style. The style is purely the track
//     fingerprint. Outcome physiology contradicts the track in cousin-mode prompts.
//   - vibe_pitch LEADS the prompt. The track's energy/essence is the most important
//     thing Suno reads; era and instrumentation come after.
//   - Personnel/gear/studio names are sanitized out (rules-v4 forbids them, sanitizer
//     belt-and-suspenders strips any that leak through).
//
// What goes IN the style portion:
//   - vibe_pitch                (LEADS — track essence)
//   - era_production_signature  (warm/lo-fi/glossy etc)
//   - instrumentation_palette   (with hierarchy: leading/under/punctuating/buried)
//   - standout_element          (the MAYA element)
//   - vocal_character           (with imperfections)
//   - harmonic_and_groove       (groove pocket + harmonic feel)
//
// What does NOT go in the style portion:
//   - Outcome (tempo/mode/dynamics/instrumentation hint) — set elsewhere on Suno
//   - vocal_arrangement         (often overlaps vocal_character; dropped to save chars)
//   - arrangement_shape, dynamic_curve (Bernie owns; encoded as [Section] markers)

import type { Decomposition } from '@prisma/client'
import { stripForSuno } from './sanitize.js'
import { capStyle } from './cap.js'

// Suno's style field cap is 1000 chars. Leave safety margin.
const FULL_CAP = 950

export interface StyleAssemblyInput {
  decomposition: Pick<
    Decomposition,
    | 'vibePitch'
    | 'eraProductionSignature'
    | 'instrumentationPalette'
    | 'standoutElement'
    | 'vocalCharacter'
    | 'harmonicAndGroove'
  >
}

const STYLE_TEMPLATE_VERSION = 2

export function getStyleTemplateVersion(): number {
  return STYLE_TEMPLATE_VERSION
}

/** Compose the style portion of a Suno submission. Pure function. No LLM. */
export function assembleStylePortion({ decomposition: d }: StyleAssemblyInput): string {
  const parts: string[] = []
  if (d.vibePitch) parts.push(stripForSuno(d.vibePitch))
  if (d.eraProductionSignature) parts.push(stripForSuno(d.eraProductionSignature))
  if (d.instrumentationPalette) parts.push(stripForSuno(d.instrumentationPalette))
  if (d.standoutElement) parts.push(stripForSuno(d.standoutElement))
  if (d.vocalCharacter) parts.push(stripForSuno(d.vocalCharacter))
  if (d.harmonicAndGroove) parts.push(stripForSuno(d.harmonicAndGroove))

  const joined = parts.filter(Boolean).join(', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  return capStyle(joined, FULL_CAP)
}
