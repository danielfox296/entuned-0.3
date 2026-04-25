// Mars StyleTemplate v1 — deterministic. Composes a Decomposition + Outcome into
// a Suno-ready style portion.
//
// Daniel's principle: "Let it breathe — don't over-engineer the style prompt."
// We emit dense, comma-separated fragments in a Suno-friendly priority order.
//
// What goes IN the style portion (what Suno responds to as sound description):
//   - era_production_signature  (sets the soundscape)
//   - instrumentation_palette   (instruments + how they're played)
//   - standout_element          (the MAYA element)
//   - vocal_character           (defining trait per intake)
//   - vocal_arrangement         (stacks, samples, processing)
//   - harmonic_and_groove       (harmonic language + pocket)
//
// What does NOT go in the style portion (handled elsewhere):
//   - vibe_pitch                (X-meets-Y framing — risks centroid drift; keep for future)
//   - arrangement_shape         (Bernie owns; encoded as [Section] markers in lyrics)
//   - dynamic_curve             (Bernie owns; same)
//
// The Outcome prepend (tempo/mode/dynamics/instrumentation hint) goes at the front.

import type { Decomposition, Outcome } from '@prisma/client'

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
  outcome: Pick<Outcome, 'tempoBpm' | 'mode' | 'dynamics' | 'instrumentation'>
}

const STYLE_TEMPLATE_VERSION = 1

export function getStyleTemplateVersion(): number {
  return STYLE_TEMPLATE_VERSION
}

/** Compose the style portion of a Suno submission. Pure function. No LLM. */
export function assembleStylePortion({ decomposition: d, outcome: o }: StyleAssemblyInput): string {
  const parts: string[] = []

  // Outcome prepend — physiology fields (Outcome owns BPM/mode/dynamics per supremacy rule).
  const outcomeFragment = [
    `${o.tempoBpm} BPM`,
    `${o.mode} key`,
    o.dynamics ? `${o.dynamics} dynamics` : null,
    o.instrumentation ? `[outcome instrumentation hint: ${o.instrumentation}]` : null,
  ].filter(Boolean).join(', ')
  parts.push(outcomeFragment)

  // Decomposition fields, in Suno-priority order.
  if (d.eraProductionSignature) parts.push(d.eraProductionSignature)
  if (d.instrumentationPalette) parts.push(d.instrumentationPalette)
  if (d.standoutElement) parts.push(`Signature: ${d.standoutElement}`)
  if (d.vocalCharacter) parts.push(`Vocals: ${d.vocalCharacter}`)
  if (d.vocalArrangement) parts.push(d.vocalArrangement)
  if (d.harmonicAndGroove) parts.push(d.harmonicAndGroove)

  return parts.join('. ').replace(/\.+/g, '.').trim()
}
