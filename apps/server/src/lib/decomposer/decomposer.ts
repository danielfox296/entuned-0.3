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
// EXPERIMENT SURFACE — versioned rules sweep (v1–v9).
//   This module ships nine versions of the MusicologicalRules prompt
//   (rules-v1.ts through rules-v9.ts). All nine are imported into the
//   RULES_BY_VERSION lookup so any past version can be restored without
//   code edits. Default is v9 (LATEST_RULES_VERSION below); v1–v8 are
//   reachable only via DECOMPOSER_RULES_VERSION env override or a
//   styleAnalyzerInstructions DB row pinned to an older version. This is
//   an active experiment surface — new versions may be added or existing
//   versions tweaked as the decomposer rules evolve. See ./README.md for
//   the per-version notes and the rule that older versions are
//   intentionally retained as rollback parachutes.

import Anthropic from '@anthropic-ai/sdk'
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

const MODEL = process.env.DECOMPOSER_MODEL ?? 'claude-sonnet-4-6'

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
}
const LATEST_RULES_VERSION = 9

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
      vibe_pitch: { type: 'string' },
      era_production_signature: { type: 'string' },
      instrumentation_palette: { type: 'string' },
      standout_element: { type: 'string' },
      arrangement_shape: { type: 'string', description: 'v1-v7 only. Drop in v8+ (information moves into arrangement_sections).' },
      dynamic_curve: { type: 'string', description: 'v1-v7 only. Drop in v8+.' },
      vocal_character: { type: 'string' },
      vocal_arrangement: { type: 'string' },
      harmonic_and_groove: { type: 'string' },
      vocal_gender: { type: 'string', enum: ['male', 'female', 'duet', 'instrumental'] },
      arrangement_sections: {
        type: 'object',
        description: 'Per-section instrumentation map (v6+).',
        additionalProperties: SECTION_PROPS,
      },
    },
    required: ['vibe_pitch', 'era_production_signature', 'instrumentation_palette', 'standout_element', 'vocal_character', 'vocal_arrangement', 'harmonic_and_groove', 'confidence'],
  },
} as const

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
  // descriptive fields
  vibe_pitch: string
  era_production_signature: string
  instrumentation_palette: string
  standout_element: string
  // Dropped in v8 — moved into arrangement_sections per section. Still emitted by v1-v7.
  arrangement_shape?: string
  dynamic_curve?: string
  vocal_character: string
  vocal_arrangement: string
  harmonic_and_groove: string
  confidence: 'low' | 'medium' | 'high'
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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const client = new Anthropic({ apiKey })

  const requiredKeys = rulesRow.version >= 8
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
  const baseTools: any[] = [EMIT_DECOMPOSITION_TOOL]
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

  const emitBlock = response.content.find(
    (b: any) => b.type === 'tool_use' && b.name === 'emit_decomposition',
  ) as any
  if (!emitBlock) throw new Error('Decomposer did not emit emit_decomposition tool_use')
  const parsed = emitBlock.input as StyleAnalysisOutput
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

function validate(o: any, rulesVersion: number): asserts o is StyleAnalysisOutput {
  const baseRequired = [
    'vibe_pitch',
    'era_production_signature',
    'instrumentation_palette',
    'standout_element',
    'vocal_character',
    'vocal_arrangement',
    'harmonic_and_groove',
    'confidence',
  ] as const
  const required: string[] = [...baseRequired]
  if (rulesVersion < 8) {
    required.push('arrangement_shape', 'dynamic_curve')
  }
  for (const k of required) {
    if (typeof o[k] !== 'string' || o[k].length === 0) {
      throw new Error(`Decomposition missing or empty field: ${k}`)
    }
  }
  if (!['low', 'medium', 'high'].includes(o.confidence)) {
    throw new Error(`Invalid confidence: ${o.confidence}`)
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
}
