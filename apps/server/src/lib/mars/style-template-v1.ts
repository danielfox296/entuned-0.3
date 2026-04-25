// Mars StyleTemplate v1 — deterministic. Composes a Decomposition + Outcome into
// a Suno-ready style portion.
//
// Daniel's principles:
//   - "Let it breathe — don't over-engineer." Punchy, comma-fragment style. No bloat.
//   - Outcome owns tempo + mode. NEITHER tempo NOR mode goes into the style prompt
//     (they conflict and they're set on Suno's side anyway). Decomposition fields
//     are sanitized to strip any BPM/key references the LLM may have leaked through.
//
// What goes IN the style portion:
//   - era_production_signature
//   - instrumentation_palette
//   - standout_element
//   - vocal_character
//   - vocal_arrangement
//   - harmonic_and_groove (sanitized of BPM/key)
//   - Outcome's dynamics + instrumentation hint (NOT tempo, NOT mode)
//
// What does NOT go in the style portion:
//   - tempo, mode, key (Outcome owns them; never written into style text)
//   - vibe_pitch (X-meets-Y; risks centroid drift)
//   - arrangement_shape, dynamic_curve (Bernie owns; encoded as [Section] markers)

import type { Decomposition, Outcome } from '@prisma/client'
import { stripTempoAndKey } from './sanitize.js'
import { capStyle } from './cap.js'

// Suno's style field is capped at 1000 chars. Leave safety margin to avoid edge cases.
const FULL_CAP = 950

export interface StyleAssemblyInput {
  decomposition: Pick<
    Decomposition,
    | 'eraProductionSignature'
    | 'instrumentationPalette'
    | 'standoutElement'
    | 'vocalCharacter'
    | 'vocalArrangement'
    | 'harmonicAndGroove'
  >
  outcome: Pick<Outcome, 'dynamics' | 'instrumentation'>
}

const STYLE_TEMPLATE_VERSION = 1

export function getStyleTemplateVersion(): number {
  return STYLE_TEMPLATE_VERSION
}

/** Compose the style portion of a Suno submission. Pure function. No LLM. */
export function assembleStylePortion({ decomposition: d, outcome: o }: StyleAssemblyInput): string {
  const parts: string[] = []

  // Outcome — only the non-conflicting physiology fields make it through.
  const outcomeBits = [
    o.dynamics ? `${o.dynamics} dynamics` : null,
    o.instrumentation,
  ].filter(Boolean)
  if (outcomeBits.length) parts.push(outcomeBits.join(', '))

  // Decomposition fields, sanitized.
  if (d.eraProductionSignature) parts.push(stripTempoAndKey(d.eraProductionSignature))
  if (d.instrumentationPalette) parts.push(stripTempoAndKey(d.instrumentationPalette))
  if (d.standoutElement) parts.push(stripTempoAndKey(d.standoutElement))
  if (d.vocalCharacter) parts.push(stripTempoAndKey(d.vocalCharacter))
  if (d.vocalArrangement) parts.push(stripTempoAndKey(d.vocalArrangement))
  if (d.harmonicAndGroove) parts.push(stripTempoAndKey(d.harmonicAndGroove))

  // Comma-joined, not period-joined: Suno reads comma-fragment style better.
  const joined = parts.filter(Boolean).join(', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  return capStyle(joined, FULL_CAP)
}
