// Reference-Track Decomposer (Card 5 v1).
// Calls Claude with MusicologicalRules + per-decade era_reference background context,
// returns the 9-field decomposition + confidence.
//
// Usage from CLI:
//   pnpm tsx scripts/decompose.ts --artist "..." --title "..." --year 1968
//
// Or programmatic:
//   const result = await decompose({ artist, title, year, decade, genreSlug })

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

const MODEL = process.env.DECOMPOSER_MODEL ?? 'claude-sonnet-4-5'

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
}
const LATEST_RULES_VERSION = 8

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

${rulesRow.version >= 2
  ? 'Use web search to ground yourself in this exact track before writing the decomposition. Search for distinguishing details. If multiple distinct tracks share this title, disambiguate via search or report confidence: low.'
  : ''}

Decompose this track per the rules. Output a single JSON object with exactly these
keys: ${requiredKeys}. No prose before or after the JSON. No markdown code fences.`

  // v2 rules use Anthropic's hosted web search tool.
  const tools = rulesRow.version >= 2
    ? [{ type: 'web_search_20250305' as const, name: 'web_search', max_uses: 3 }]
    : undefined

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: rulesRow.rulesText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: tools as any,
    messages: [{ role: 'user', content: userMessage }],
  })

  // With web search enabled, the response has multiple content blocks: server_tool_use,
  // web_search_tool_result, and one or more text blocks. The final text block holds the
  // structured output. Take the last text block and pull a JSON object out of it.
  const textBlocks = response.content.filter((b: any) => b.type === 'text') as any[]
  if (textBlocks.length === 0) throw new Error('Model returned no text content')
  const raw = textBlocks[textBlocks.length - 1].text as string

  const cleaned = extractJson(raw)
  let parsed: StyleAnalysisOutput
  try {
    parsed = JSON.parse(cleaned) as StyleAnalysisOutput
    validate(parsed, rulesRow.version)
  } catch (e) {
    console.error('--- raw model output (validation/parse failed) ---')
    console.error(raw)
    console.error('--- end raw output ---')
    throw e
  }

  return {
    output: parsed,
    rawText: raw,
    modelId: response.model,
    rulesVersion: rulesRow.version,
    eraContext,
  }
}

function stripCodeFences(s: string): string {
  // Defensive — Claude sometimes wraps JSON in ```json fences (per memory).
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

/** Extract the first balanced JSON object substring. Tolerates prose before/after. */
function extractJson(s: string): string {
  const cleaned = stripCodeFences(s)
  if (cleaned.startsWith('{')) return cleaned
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in model output')
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return cleaned.slice(start, i + 1)
    }
  }
  throw new Error('Unbalanced JSON object in model output')
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
