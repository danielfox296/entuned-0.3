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

const MODEL = process.env.DECOMPOSER_MODEL ?? 'claude-sonnet-4-5'

export interface DecomposeInput {
  artist: string
  title: string
  year?: number
  /** "1960s" through "2020s". If omitted, derived from year. */
  decade?: string
  /** Optional genre hint (slug from era_references); the model can override. */
  genreSlug?: string
}

export interface DecompositionOutput {
  vibe_pitch: string
  era_production_signature: string
  instrumentation_palette: string
  standout_element: string
  arrangement_shape: string
  dynamic_curve: string
  vocal_character: string
  vocal_arrangement: string
  harmonic_and_groove: string
  confidence: 'low' | 'medium' | 'high'
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

  const rows = await prisma.eraReference.findMany({
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
  output: DecompositionOutput
  rawText: string
  modelId: string
  rulesVersion: number
  eraContext: string
}

export async function decompose(input: DecomposeInput): Promise<DecomposeResult> {
  const decade = input.decade ?? (input.year ? decadeFromYear(input.year) : '2000s')
  const eraContext = await buildEraContext(decade, input.genreSlug)

  // Latest MusicologicalRules version (or seed v1 inline).
  let rulesRow = await prisma.musicologicalRules.findFirst({ orderBy: { version: 'desc' } })
  if (!rulesRow) {
    rulesRow = await prisma.musicologicalRules.create({
      data: { version: 1, rulesText: MUSICOLOGICAL_RULES_V1, notes: 'Initial v1 seed' },
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const client = new Anthropic({ apiKey })

  const userMessage = `# Track to decompose

Artist: ${input.artist}
Title: ${input.title}
${input.year ? `Year: ${input.year}` : ''}
Decade: ${decade}
${input.genreSlug ? `Genre hint: ${input.genreSlug}` : ''}

# Background context (era reference data — informs but does not replace track-specific listening)

${eraContext}

# Task

Decompose this track per the rules. Output a single JSON object with exactly these
keys: vibe_pitch, era_production_signature, instrumentation_palette, standout_element,
arrangement_shape, dynamic_curve, vocal_character, vocal_arrangement, harmonic_and_groove,
confidence. No prose before or after the JSON. No markdown code fences.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: rulesRow.rulesText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((b: any) => b.type === 'text') as any
  if (!textBlock?.text) throw new Error('Model returned no text content')

  const raw = textBlock.text
  const cleaned = stripCodeFences(raw)
  let parsed: DecompositionOutput
  try {
    parsed = JSON.parse(cleaned) as DecompositionOutput
    validate(parsed)
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

function validate(o: any): asserts o is DecompositionOutput {
  const required: (keyof DecompositionOutput)[] = [
    'vibe_pitch',
    'era_production_signature',
    'instrumentation_palette',
    'standout_element',
    'arrangement_shape',
    'dynamic_curve',
    'vocal_character',
    'vocal_arrangement',
    'harmonic_and_groove',
    'confidence',
  ]
  for (const k of required) {
    if (typeof o[k] !== 'string' || o[k].length === 0) {
      throw new Error(`Decomposition missing or empty field: ${k}`)
    }
  }
  if (!['low', 'medium', 'high'].includes(o.confidence)) {
    throw new Error(`Invalid confidence: ${o.confidence}`)
  }
}
