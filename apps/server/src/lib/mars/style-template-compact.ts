// Compact StyleTemplate (~target 600 chars). Drops fields that overlap or that Suno
// can infer from the era + instrumentation alone.
//
// Kept (signal-dense):
//   - dynamics (Outcome)
//   - era_production_signature
//   - instrumentation_palette (with playing style)
//   - standout_element (the MAYA element)
//   - vocal_character (the giveaway)
//
// Dropped (redundant or low-signal-per-char in compact mode):
//   - outcome instrumentation hint (often duplicates instrumentation_palette)
//   - vocal_arrangement (often restates vocal_character)
//   - harmonic_and_groove (groove is implicit in era + instrumentation)

import type { Decomposition, Outcome } from '@prisma/client'
import { stripTempoAndKey } from './sanitize.js'
import { capStyle } from './cap.js'

const COMPACT_CAP = 550

export interface CompactInput {
  decomposition: Pick<
    Decomposition,
    'eraProductionSignature' | 'instrumentationPalette' | 'standoutElement' | 'vocalCharacter'
  >
  outcome: Pick<Outcome, 'dynamics'>
}

const COMPACT_TEMPLATE_VERSION = 1

export function getCompactTemplateVersion(): number {
  return COMPACT_TEMPLATE_VERSION
}

/** Truncate a string at the last comma (or whitespace) within `max` chars. */
function softCap(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  // Prefer a clean break at a comma; fall back to whitespace.
  const lastComma = cut.lastIndexOf(',')
  const lastSpace = cut.lastIndexOf(' ')
  const breakAt = lastComma > max * 0.6 ? lastComma : (lastSpace > max * 0.6 ? lastSpace : max)
  return cut.slice(0, breakAt).replace(/[,\s]+$/, '')
}

const PER_FIELD_CAP = 140 // ~140 chars × 5 fields ≈ 700; dynamics adds ~30 → ~730 ceiling, often less

export function assembleCompactStyle({ decomposition: d, outcome: o }: CompactInput): string {
  const parts: string[] = []
  if (o.dynamics) parts.push(`${o.dynamics} dynamics`)
  if (d.eraProductionSignature) parts.push(softCap(stripTempoAndKey(d.eraProductionSignature), PER_FIELD_CAP))
  if (d.instrumentationPalette) parts.push(softCap(stripTempoAndKey(d.instrumentationPalette), PER_FIELD_CAP))
  if (d.standoutElement) parts.push(softCap(stripTempoAndKey(d.standoutElement), PER_FIELD_CAP))
  if (d.vocalCharacter) parts.push(softCap(stripTempoAndKey(d.vocalCharacter), PER_FIELD_CAP))
  const joined = parts.filter(Boolean).join(', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  return capStyle(joined, COMPACT_CAP)
}
