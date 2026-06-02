// Reference-Track Decomposer (Card 5 v1).
// Calls Claude with MusicologicalRules + per-decade era_reference background context,
// returns the 9-field decomposition + confidence.
//
// Usage from CLI:
//   pnpm tsx scripts/decompose.ts --artist "..." --title "..." --year 1968
//
// Or programmatic:
//   const result = await decompose({ artist, title, year, decade, genreSlug })
//
// EXPERIMENT SURFACE — versioned rules sweep (v1–v12).
//   This module ships twelve versions of the MusicologicalRules prompt
//   (rules-v1.ts through rules-v12.ts). All twelve are imported into the
//   RULES_BY_VERSION lookup so any past version can be restored without
//   code edits. Default is v12 (LATEST_RULES_VERSION below); v1–v11 are
//   reachable only via DECOMPOSER_RULES_VERSION env override or a
//   styleAnalyzerInstructions DB row pinned to an older version. This is
//   an active experiment surface — new versions may be added or existing
//   versions tweaked as the decomposer rules evolve. See ./README.md for
//   the per-version notes and the rule that older versions are
//   intentionally retained as rollback parachutes.

import { getAnthropic, resolveModel, extractToolUse } from '../_llm/client.js'
import { prisma } from '../../db.js'
import { MUSICOLOGICAL_RULES_V1 } from './rules-v1.js'
import { MUSICOLOGICAL_RULES_V2 } from './rules-v2.js'
import { MUSICOLOGICAL_RULES_V3 } from './rules-v3.js'
import { MUSICOLOGICAL_RULES_V4 } from './rules-v4.js'
import { MUSICOLOGICAL_RULES_V5 } from './rules-v5.js'
import { MUSICOLOGICAL_RULES_V6 } from './rules-v6.js'
import { MUSICOLOGICAL_RULES_V7 } from './rules-v7.js'
import { MUSICOLOGICAL_RULES_V8 } from './rules-v8.js'
import { MUSICOLOGICAL_RULES_V9 } from './rules-v9.js'
import { MUSICOLOGICAL_RULES_V10 } from './rules-v10.js'
import { MUSICOLOGICAL_RULES_V11 } from './rules-v11.js'
import { MUSICOLOGICAL_RULES_V12 } from './rules-v12.js'
import { MUSICOLOGICAL_RULES_V13 } from './rules-v13.js'
import { Prisma } from '@prisma/client'

const MODEL = resolveModel(process.env.DECOMPOSER_MODEL, 'claude-sonnet-4-6')

// Versioned rule selection. Default to latest. Override via env DECOMPOSER_RULES_VERSION=1.
const RULES_BY_VERSION: Record<number, string> = {
  1: MUSICOLOGICAL_RULES_V1,
  2: MUSICOLOGICAL_RULES_V2,
  3: MUSICOLOGICAL_RULES_V3,
  4: MUSICOLOGICAL_RULES_V4,
  5: MUSICOLOGICAL_RULES_V5,
  6: MUSICOLOGICAL_RULES_V6,
  7: MUSICOLOGICAL_RULES_V7,
  8: MUSICOLOGICAL_RULES_V8,
  9: MUSICOLOGICAL_RULES_V9,
  10: MUSICOLOGICAL_RULES_V10,
  11: MUSICOLOGICAL_RULES_V11,
  12: MUSICOLOGICAL_RULES_V12,
  13: MUSICOLOGICAL_RULES_V13,
}
const LATEST_RULES_VERSION = 13

// v13 emits structured fields discretely and stops emitting the prose fields that
// never reached Suno. This is the first version-keyed CONTRACT change since v8 —
// the validate() + required-keys logic below branches on it.
const STRUCTURED_FIELDS_VERSION = 13

const SECTION_PROPS = {
  type: 'object',
  properties: {
    instruments: { type: 'array', items: { type: 'string' } },
    density: { type: 'string' },
    dynamic: { type: 'string' },
    vocal_delivery: { type: 'string' },
  },
  required: ['instruments'],
} as const

const EMIT_DECOMPOSITION_TOOL = {
  name: 'emit_decomposition',
  description: 'Emit the structured musicological decomposition per the rules. Call this exactly once after any web research.',
  input_schema: {
    type: 'object',
    properties: {
      verifiable_facts: { type: 'string' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      vibe_pitch: { type: 'string', description: 'v1-v12 only. Retired in v13 (replaced by genre_anchor).' },
      era_production_signature: {
        type: 'string',
        description: 'HARD CAP 40 chars. Schema: `<decade-prefix>, <1-2 production words>`. Decade-prefix is one of: early-60s, mid-60s, late-60s, early-70s, ..., early-2020s, mid-2020s (must be the FIRST token). Production words: lo-fi, polished, tape, DAW, home-recorded, dry, wet, saturated, warm tape, room bleed, gated reverb, sidechain, plate reverb, spring reverb, tape echo, compression, sampling. Feeds the negative-style production axis + exclusion rules, not the positive style.',
      },
      instrumentation_palette: { type: 'string' },
      standout_element: { type: 'string' },
      arrangement_shape: { type: 'string', description: 'v1-v7 only. Drop in v8+ (information moves into arrangement_sections).' },
      dynamic_curve: { type: 'string', description: 'v1-v7 only. Drop in v8+.' },
      vocal_character: { type: 'string' },
      vocal_arrangement: { type: 'string', description: 'v1-v12 only. Retired in v13 (folded into vocal_character).' },
      harmonic_and_groove: { type: 'string', description: 'v1-v12 only. Retired in v13 (split into harmonic_character + groove_character).' },
      vocal_gender: { type: 'string', enum: ['male', 'female', 'duet', 'instrumental'] },
      // v13+ structured fields.
      genre_anchor: { type: 'string', description: 'v13+. One clean `<subgenre> <decade>` tag (e.g. "1990s trip-hop"). No comma stacks, no prose, no affect. The canonical genre centroid the pipeline anchors on.' },
      harmonic_character: { type: 'string', description: 'v13+. Chord language only (modal interchange, deceptive cadence, jazz-inflected extended chords, etc.). No groove here.' },
      groove_character: { type: 'string', description: 'v13+. Groove pocket + tempo-feel only (behind-the-beat, mid-tempo, swung, sampled loop, etc.). No chords here.' },
      vocal_register: { type: 'string', description: 'v13+. One register word (tenor/baritone/alto/soprano/falsetto/...). Empty string if instrumental.' },
      arrangement_sections: {
        type: 'object',
        description: 'Per-section instrumentation map (v6+).',
        additionalProperties: SECTION_PROPS,
      },
      bpm: {
        type: ['integer', 'null'],
        description: 'v10+. Track tempo (BPM), integer or null. Web-search grounded; main-body tempo, not intro/outro; aligned to snare/backbeat (not hi-hat subdivision). Null only when no confident tempo source is available — a null bpm BENCHES the ref from tempo-matched picking (it is NOT treated as matching every tempo), so emit a grounded number whenever you can. Do NOT lower overall confidence solely because tempo is null: confidence reflects track identification/verification, not tempo certainty. Private picker data — never rendered into a Suno prompt.',
      },
    },
    // Legacy (v1-v12) required set. v13+ overrides via buildEmitTool below.
    required: ['vibe_pitch', 'era_production_signature', 'instrumentation_palette', 'standout_element', 'vocal_character', 'vocal_arrangement', 'harmonic_and_groove', 'confidence'],
  },
} as const

// v13 structured-fields required set. era_production_signature is kept (compact) — it
// feeds the negative-style production axis + DB exclusion rules, not the positive style.
const V13_REQUIRED_KEYS = [
  'genre_anchor', 'era_production_signature', 'instrumentation_palette', 'standout_element',
  'vocal_character', 'vocal_gender', 'harmonic_character', 'groove_character', 'confidence',
]

// The tool's property set is shared across versions (so older versions remain
// reachable via env override); only the `required` array is version-keyed.
export function buildEmitTool(version: number) {
  const required = version >= STRUCTURED_FIELDS_VERSION
    ? V13_REQUIRED_KEYS
    : EMIT_DECOMPOSITION_TOOL.input_schema.required
  return {
    ...EMIT_DECOMPOSITION_TOOL,
    input_schema: { ...EMIT_DECOMPOSITION_TOOL.input_schema, required },
  }
}

export interface DecomposeInput {
  artist: string
  title: string
  year?: number
  /** "1960s" through "2020s". If omitted, derived from year. */
  decade?: string
  /** Optional genre hint (slug from era_references); the model can override. */
  genreSlug?: string
  /**
   * Operator producer-ear hints. Authoritative — model treats these as fact about the
   * track and incorporates them across relevant fields. Use to convey track-specific
   * production detail (sidechain, sample manipulation, flammed snare, etc.) that web
   * sources don't surface.
   */
  operatorNotes?: string
}

export interface StyleAnalysisOutput {
  // v2+ grounding fields
  verifiable_facts?: string
  // descriptive fields kept across all versions
  instrumentation_palette: string
  standout_element: string
  vocal_character: string
  confidence: 'low' | 'medium' | 'high'
  // v1-v12 prose fields — retired in v13 (replaced by the structured fields below).
  vibe_pitch?: string
  era_production_signature?: string
  vocal_arrangement?: string
  harmonic_and_groove?: string
  // Dropped in v8 — moved into arrangement_sections per section. Still emitted by v1-v7.
  arrangement_shape?: string
  dynamic_curve?: string
  // v13+ structured fields.
  genre_anchor?: string
  harmonic_character?: string
  groove_character?: string
  vocal_register?: string
  // v3+: explicit gender for Suno
  vocal_gender?: 'male' | 'female' | 'duet' | 'instrumental'
  // v6+: per-section instrumentation map for the Arranger module.
  // v8+ adds optional `dynamic` and `vocal_delivery` per section.
  arrangement_sections?: Record<
    string,
    {
      instruments: string[]
      density?: string
      dynamic?: string
      vocal_delivery?: string
    }
  >
  // v10+: numeric BPM. Private picker-compatibility data — never rendered.
  // See schema/05-reference-track-decomposition.md "The BPM doctrine, restated".
  bpm?: number | null
}

function decadeFromYear(y: number): string {
  if (y < 1940) return '1940s'
  const d = Math.floor(y / 10) * 10
  return `${d}s`
}

async function buildEraContext(decade: string, genreSlug?: string): Promise<string> {
  // Pull the matching genre row + the decade's overview row. Both feed context.
  const where = genreSlug
    ? { decade, OR: [{ genreSlug }, { genreSlug: 'overview' }] }
    : { decade, genreSlug: 'overview' }

  const rows = await prisma.productionEra.findMany({
    where: { ...where, isActive: true },
    orderBy: [{ genreSlug: 'asc' }],
  })

  if (rows.length === 0) {
    return `(No era_reference data found for decade=${decade}. Rely on general knowledge.)`
  }

  const blocks = rows.map((r) => {
    const lines: string[] = []
    lines.push(`## ${r.decade} ${r.genreDisplayName ?? r.genreSlug}${r.isEraOverview ? ' (overview)' : ''}`)
    if (r.promptBlock) lines.push(`Prompt block: ${r.promptBlock}`)
    if (r.textureLanguage) lines.push(`Texture language: ${r.textureLanguage}`)
    if (r.instruments) lines.push(`Typical instrumentation: ${r.instruments}`)
    if (r.recordingChain) lines.push(`Recording chain: ${r.recordingChain}`)
    if (r.vocalsDescription) lines.push(`Vocal characteristics: ${r.vocalsDescription}`)
    if (r.excludeList) lines.push(`Exclude (Suno drift signals to avoid): ${r.excludeList}`)
    if (r.sunoDriftNotes) lines.push(`Suno drift notes: ${r.sunoDriftNotes}`)
    return lines.join('\n')
  })

  return blocks.join('\n\n')
}

export interface DecomposeResult {
  output: StyleAnalysisOutput
  rawText: string
  modelId: string
  rulesVersion: number
  eraContext: string
}

export async function decompose(input: DecomposeInput): Promise<DecomposeResult> {
  const decade = input.decade ?? (input.year ? decadeFromYear(input.year) : '2000s')
  const eraContext = await buildEraContext(decade, input.genreSlug)

  // Pick the rules version: env override, else latest, else seed.
  const rulesVersionRequested = process.env.DECOMPOSER_RULES_VERSION
    ? parseInt(process.env.DECOMPOSER_RULES_VERSION, 10)
    : LATEST_RULES_VERSION
  let rulesRow = await prisma.styleAnalyzerInstructions.findUnique({ where: { version: rulesVersionRequested } })
  if (!rulesRow) {
    const text = RULES_BY_VERSION[rulesVersionRequested] ?? MUSICOLOGICAL_RULES_V1
    rulesRow = await prisma.styleAnalyzerInstructions.create({
      data: { version: rulesVersionRequested, rulesText: text, notes: `Auto-seed v${rulesVersionRequested}` },
    })
  }

  const client = getAnthropic()

  const requiredKeys = rulesRow.version >= 10
    ? 'verifiable_facts, confidence, vibe_pitch, era_production_signature, instrumentation_palette, standout_element, vocal_character, vocal_arrangement, harmonic_and_groove, vocal_gender, arrangement_sections, bpm'
    : rulesRow.version >= 8
    ? 'verifiable_facts, confidence, vibe_pitch, era_production_signature, instrumentation_palette, standout_element, vocal_character, vocal_arrangement, harmonic_and_groove, vocal_gender, arrangement_sections'
    : rulesRow.version >= 6
    ? 'verifiable_facts, confidence, vibe_pitch, era_production_signature, instrumentation_palette, standout_element, arrangement_shape, dynamic_curve, vocal_character, vocal_arrangement, harmonic_and_groove, vocal_gender, arrangement_sections'
    : rulesRow.version >= 3
    ? 'verifiable_facts, confidence, vibe_pitch, era_production_signature, instrumentation_palette, standout_element, arrangement_shape, dynamic_curve, vocal_character, vocal_arrangement, harmonic_and_groove, vocal_gender'
    : rulesRow.version >= 2
    ? 'verifiable_facts, confidence, vibe_pitch, era_production_signature, instrumentation_palette, standout_element, arrangement_shape, dynamic_curve, vocal_character, vocal_arrangement, harmonic_and_groove'
    : 'vibe_pitch, era_production_signature, instrumentation_palette, standout_element, arrangement_shape, dynamic_curve, vocal_character, vocal_arrangement, harmonic_and_groove, confidence'

  // v9+: system prompt already enumerates required keys, so we drop the redundant
  // restatement in the user message. v1-v8 keep the original line for backward compat.
  const keysLine = rulesRow.version >= 9
    ? ''
    : `Output a single JSON object with exactly these keys: ${requiredKeys}. `

  const operatorNotesBlock = input.operatorNotes?.trim()
    ? `# Operator producer notes (AUTHORITATIVE — these come from a human producer who
heard the track. Treat as ground truth and incorporate across the relevant fields,
even if web search results disagree on these specific details.)

${input.operatorNotes.trim()}
`
    : ''

  const userMessage = `# Track to decompose

Artist: ${input.artist}
Title: ${input.title}
${input.year ? `Year: ${input.year}` : ''}
Decade: ${decade}
${input.genreSlug ? `Genre hint: ${input.genreSlug}` : ''}

${operatorNotesBlock}# Background context (era reference data — informs but does not replace track-specific listening)

${eraContext}

# Task

${rulesRow.version >= 2 ? 'Use web search to ground yourself in this exact track before writing the decomposition. ' : ''}Decompose this track per the rules and emit the result via the emit_decomposition tool. Call emit_decomposition exactly once, after any web research.`

  // emit_decomposition is always emitted; web_search is added when v2+ rules apply.
  // tool_choice is omitted ('auto') so the model can chain web_search calls before
  // emit_decomposition — forcing the custom tool would preclude web_search entirely.
  const baseTools: any[] = [buildEmitTool(rulesRow.version)]
  if (rulesRow.version >= 2) {
    baseTools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3 })
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // Extractive task — lower temperature improves consistency without hurting
    // quality.
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: rulesRow.rulesText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: baseTools,
    messages: [{ role: 'user', content: userMessage }],
  })

  const emitInput = extractToolUse(response, 'emit_decomposition')
  if (!emitInput) throw new Error('Decomposer did not emit emit_decomposition tool_use')
  const parsed = emitInput as StyleAnalysisOutput
  try {
    validate(parsed, rulesRow.version)
  } catch (e) {
    console.error('--- raw model output (validation failed) ---')
    console.error(JSON.stringify(parsed, null, 2))
    console.error('--- end raw output ---')
    throw e
  }
  const raw = JSON.stringify(parsed)

  return {
    output: parsed,
    rawText: raw,
    modelId: response.model,
    rulesVersion: rulesRow.version,
    eraContext,
  }
}

// v8 dropped arrangement_shape and dynamic_curve as standalone fields. Their information
// moves into per-section `dynamic` keys inside arrangement_sections.
const ALLOWED_SECTION_DYNAMIC = new Set([
  'steady', 'building', 'dropping', 'stripped', 'erupting', 'fade', 'sustained', 'retreating',
])
const ALLOWED_VOCAL_DELIVERY = new Set([
  'close-mic', 'distant', 'whispered', 'belted', 'falsetto', 'stacked', 'doubled', 'wordless', 'instrumental', 'a-cappella',
])

export function validate(o: any, rulesVersion: number): asserts o is StyleAnalysisOutput {
  // v13+ emits structured fields; v1-v12 emit the prose contract. The required
  // set is version-keyed to match what each rules version is told to produce.
  let required: string[]
  if (rulesVersion >= STRUCTURED_FIELDS_VERSION) {
    required = [
      'genre_anchor',
      'era_production_signature',
      'instrumentation_palette',
      'standout_element',
      'vocal_character',
      'harmonic_character',
      'groove_character',
      'confidence',
    ]
  } else {
    required = [
      'vibe_pitch',
      'era_production_signature',
      'instrumentation_palette',
      'standout_element',
      'vocal_character',
      'vocal_arrangement',
      'harmonic_and_groove',
      'confidence',
    ]
    if (rulesVersion < 8) {
      required.push('arrangement_shape', 'dynamic_curve')
    }
  }
  for (const k of required) {
    if (typeof o[k] !== 'string' || o[k].length === 0) {
      throw new Error(`Decomposition missing or empty field: ${k}`)
    }
  }
  if (!['low', 'medium', 'high'].includes(o.confidence)) {
    throw new Error(`Invalid confidence: ${o.confidence}`)
  }
  // v13 requires a valid vocal_gender enum (load-bearing for Suno's vocal toggle).
  // vocal_register may be empty (instrumental tracks), so it is NOT required.
  if (rulesVersion >= STRUCTURED_FIELDS_VERSION) {
    if (!['male', 'female', 'duet', 'instrumental'].includes(o.vocal_gender)) {
      throw new Error(`Invalid vocal_gender: ${o.vocal_gender}`)
    }
  }
  if (o.arrangement_sections !== undefined) {
    if (typeof o.arrangement_sections !== 'object' || o.arrangement_sections === null || Array.isArray(o.arrangement_sections)) {
      throw new Error('arrangement_sections must be an object')
    }
    for (const [sec, dir] of Object.entries(o.arrangement_sections)) {
      const d = dir as any
      if (!d || !Array.isArray(d.instruments)) {
        throw new Error(`arrangement_sections.${sec} missing instruments array`)
      }
      if (d.instruments.length === 0) {
        throw new Error(`arrangement_sections.${sec} has empty instruments array`)
      }
      if (d.instruments.length > 3) {
        // Suno reliability cap. Trim rather than fail — model may overshoot.
        d.instruments = d.instruments.slice(0, 3)
      }
      if (!d.instruments.every((s: any) => typeof s === 'string' && s.length > 0)) {
        throw new Error(`arrangement_sections.${sec} instruments must be non-empty strings`)
      }
      // v8+ optional per-section tags. Drop silently if not in the allowed enums —
      // the model's free to omit, and a stray value shouldn't fail the whole call.
      if (rulesVersion >= 8) {
        if (typeof d.dynamic === 'string' && !ALLOWED_SECTION_DYNAMIC.has(d.dynamic)) {
          delete d.dynamic
        }
        if (typeof d.vocal_delivery === 'string' && !ALLOWED_VOCAL_DELIVERY.has(d.vocal_delivery)) {
          delete d.vocal_delivery
        }
      }
    }
  }
  // v10+ bpm: integer in (0, 300] or null. Drop silently if the value is
  // outside that range — better to lose the picker hint than fail the whole
  // decomposition over a hallucinated tempo.
  if (rulesVersion >= 10 && o.bpm !== undefined && o.bpm !== null) {
    if (typeof o.bpm !== 'number' || !Number.isInteger(o.bpm) || o.bpm <= 0 || o.bpm > 300) {
      o.bpm = null
    }
  }
}

/**
 * Map a DecomposeResult onto the Prisma `StyleAnalysis` upsert payload.
 *
 * Single source of truth for the snake_case (model output) → camelCase (Prisma
 * column) mapping. Previously this block was copy-pasted across four admin route
 * handlers; the lazy-decompose picker path (lib/eno) also uses it. Handles both
 * the v1-v12 prose contract and the v13 structured contract — each version only
 * populates the columns it emits; the rest fall to null and consumers normalize
 * (see normalizeStyleAnalysis in lib/eno/eno.ts).
 */
export function toStyleAnalysisData(result: DecomposeResult) {
  const o = result.output
  // The pipe is the reserved delimiter normalizeStyleAnalysis uses to fuse
  // harmonic_character + groove_character into the legacy harmonicAndGroove column.
  // Strip any stray pipe the model emits in a discrete field so the round-trip split
  // can't mis-assign. (Also keeps genre_anchor a clean single tag.)
  const noPipe = (s: string | null | undefined): string | null => {
    const t = s?.replace(/\s*\|\s*/g, ', ').trim()
    return t ? t : null
  }
  return {
    styleAnalyzerInstructionsVersion: result.rulesVersion,
    status: 'draft' as const,
    verifiedAt: null,
    verifiedById: null,
    confidence: o.confidence,
    // kept across all versions
    instrumentationPalette: o.instrumentation_palette ?? null,
    standoutElement: o.standout_element ?? null,
    vocalCharacter: o.vocal_character ?? null,
    arrangementSections: o.arrangement_sections ?? Prisma.JsonNull,
    arrangementVersion: o.arrangement_sections ? result.rulesVersion : null,
    bpm: o.bpm ?? null,
    // v1-v12 prose fields (null on v13 rows)
    vibePitch: o.vibe_pitch ?? null,
    eraProductionSignature: o.era_production_signature ?? null,
    vocalArrangement: o.vocal_arrangement ?? null,
    harmonicAndGroove: o.harmonic_and_groove ?? null,
    arrangementShape: o.arrangement_shape ?? null,
    dynamicCurve: o.dynamic_curve ?? null,
    // v13 structured fields (null on pre-v13 rows). Pipe-stripped — see noPipe above.
    genreAnchor: noPipe(o.genre_anchor),
    harmonicCharacter: noPipe(o.harmonic_character),
    grooveCharacter: noPipe(o.groove_character),
    vocalRegister: o.vocal_register ?? null,
    vocalGender: o.vocal_gender ?? null,
  }
}
