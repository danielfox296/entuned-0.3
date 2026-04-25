// Compact StyleTemplate (~target 550 chars). Drops the lower-signal fields.
//
// Kept (signal-dense):
//   - vibe_pitch                (LEADS — track essence)
//   - era_production_signature
//   - instrumentation_palette
//   - vocal_character
//
// Dropped (still-valuable but lower signal-per-char in compact):
//   - standout_element  (often overlaps vibe_pitch and instrumentation lead)
//   - harmonic_and_groove (often inferable from era + instrumentation)

import type { Decomposition } from '@prisma/client'
import { stripForSuno } from './sanitize.js'
import { capStyle } from './cap.js'

export interface CompactInput {
  decomposition: Pick<
    Decomposition,
    'vibePitch' | 'eraProductionSignature' | 'instrumentationPalette' | 'vocalCharacter'
  >
}

const COMPACT_TEMPLATE_VERSION = 2

export function getCompactTemplateVersion(): number {
  return COMPACT_TEMPLATE_VERSION
}

/** Truncate at the last comma (or whitespace) within `max` chars. */
function softCap(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastComma = cut.lastIndexOf(',')
  const lastSpace = cut.lastIndexOf(' ')
  const breakAt = lastComma > max * 0.6 ? lastComma : (lastSpace > max * 0.6 ? lastSpace : max)
  return cut.slice(0, breakAt).replace(/[,\s]+$/, '')
}

const PER_FIELD_CAP = 140
const COMPACT_CAP = 550

export function assembleCompactStyle({ decomposition: d }: CompactInput): string {
  const parts: string[] = []
  if (d.vibePitch) parts.push(softCap(stripForSuno(d.vibePitch), PER_FIELD_CAP))
  if (d.eraProductionSignature) parts.push(softCap(stripForSuno(d.eraProductionSignature), PER_FIELD_CAP))
  if (d.instrumentationPalette) parts.push(softCap(stripForSuno(d.instrumentationPalette), PER_FIELD_CAP))
  if (d.vocalCharacter) parts.push(softCap(stripForSuno(d.vocalCharacter), PER_FIELD_CAP))
  const joined = parts.filter(Boolean).join(', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  return capStyle(joined, COMPACT_CAP)
}
