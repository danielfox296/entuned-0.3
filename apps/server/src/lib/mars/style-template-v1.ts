// Mars StyleTemplate v1 — deterministic. Composes a Decomposition into a Suno-ready
// style portion.
//
// Locked 2026-04-25 (field semantics) / DB-backed 2026-05-25 (configuration).
//
// What goes IN the style portion — now operator-editable from Dash → Prompts &
// Rules → Style Template. Choose which decomposition fields to include and in
// what order, plus the total char cap. The cold-start seed below matches the
// pre-migration hardcoded shape so behavior is unchanged on first deploy.
//
// Field-order rationale (the seed defaults):
//   - vibe_pitch                LEADS — track essence; Suno reads this hardest
//   - era_production_signature  warm/lo-fi/glossy
//   - instrumentation_palette   with hierarchy: leading/under/punctuating/buried
//   - standout_element          the MAYA element
//   - vocal_character           with imperfections
//   - harmonic_and_groove       groove pocket + harmonic feel
//
// Fields available but NOT in the default seed (operator can opt in):
//   - vocal_arrangement         often overlaps vocal_character
//   - arrangement_shape         Bernie owns; encoded as [Section] markers
//   - dynamic_curve             Bernie owns
//
// Outcome (tempo/mode/dynamics) is set on Suno's other params, not here. The
// style portion is purely the track fingerprint.

import type { StyleAnalysis } from '@prisma/client'
import { prisma } from '../../db.js'
import { stripForSuno } from './sanitize.js'
import { capStyle } from './cap.js'

// Fields available on StyleAnalysis that can be composed into the style portion.
// Add to this set when StyleAnalysis grows new fields the operator might want
// to include. Order here doesn't matter — the operator-edited DB row controls order.
export const STYLE_TEMPLATE_AVAILABLE_FIELDS = [
  'vibePitch',
  'eraProductionSignature',
  'instrumentationPalette',
  'standoutElement',
  'vocalCharacter',
  'vocalArrangement',
  'harmonicAndGroove',
  'arrangementShape',
  'dynamicCurve',
] as const

export type StyleTemplateField = (typeof STYLE_TEMPLATE_AVAILABLE_FIELDS)[number]

// Cold-start seed only. Live config is in `style_templates`; edit in Dash.
export const STYLE_TEMPLATE_SEED_FIELDS: readonly StyleTemplateField[] = [
  'vibePitch',
  'eraProductionSignature',
  'instrumentationPalette',
  'standoutElement',
  'vocalCharacter',
  'harmonicAndGroove',
]

export const STYLE_TEMPLATE_SEED_CHAR_CAP = 950

export interface StyleAssemblyInput {
  decomposition: StyleAnalysis
}

interface ActiveTemplate {
  version: number
  fields: StyleTemplateField[]
  charCap: number
}

let seedAttempted = false
async function loadActiveTemplate(): Promise<ActiveTemplate> {
  // Latest version wins. Append-only — operators iterate by saving a new version.
  let row = await prisma.styleTemplate.findFirst({ orderBy: { version: 'desc' } })

  // Cold-start: empty table OR pre-migration rows with empty fields[].
  // First-encounter populates v1 with the seed config so runtime never falls
  // back to constants after this point.
  if ((!row || row.fields.length === 0) && !seedAttempted) {
    seedAttempted = true
    const max = await prisma.styleTemplate.aggregate({ _max: { version: true } })
    const nextVersion = (max._max.version ?? 0) + 1
    row = await prisma.styleTemplate.create({
      data: {
        version: nextVersion,
        fields: [...STYLE_TEMPLATE_SEED_FIELDS],
        charCap: STYLE_TEMPLATE_SEED_CHAR_CAP,
        templateText: summarizeTemplate([...STYLE_TEMPLATE_SEED_FIELDS], STYLE_TEMPLATE_SEED_CHAR_CAP),
        notes: 'Auto-seeded from STYLE_TEMPLATE_SEED_FIELDS (cold-start, post-migration).',
      },
    })
  }

  if (!row || row.fields.length === 0) {
    // Should be unreachable after the seed above, but degrade gracefully.
    return {
      version: 0,
      fields: [...STYLE_TEMPLATE_SEED_FIELDS],
      charCap: STYLE_TEMPLATE_SEED_CHAR_CAP,
    }
  }

  // Filter out any fields that aren't in the available set (defensive — operator
  // could in theory save an unknown field name; we ignore those at assembly time).
  const validFields = row.fields.filter((f): f is StyleTemplateField =>
    STYLE_TEMPLATE_AVAILABLE_FIELDS.includes(f as StyleTemplateField),
  )
  return { version: row.version, fields: validFields, charCap: row.charCap }
}

export function summarizeTemplate(fields: string[], charCap: number): string {
  return `fields: [${fields.join(', ')}] · cap: ${charCap}`
}

export async function getStyleTemplateVersion(): Promise<number> {
  const t = await loadActiveTemplate()
  return t.version
}

/** Compose the style portion of a Suno submission. DB-backed config; pure
 *  assembly. No LLM. */
export async function assembleStylePortion({ decomposition: d }: StyleAssemblyInput): Promise<string> {
  const tpl = await loadActiveTemplate()
  const parts: string[] = []
  for (const field of tpl.fields) {
    const raw = (d as Record<string, unknown>)[field]
    if (typeof raw === 'string' && raw.trim()) {
      parts.push(stripForSuno(raw))
    }
  }
  const joined = parts.filter(Boolean).join(', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  return capStyle(joined, tpl.charCap)
}
