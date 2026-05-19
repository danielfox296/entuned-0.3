// Content Multiplier — fans out proof points into every format.
//
// Reads every ProofPoint row, checks which CONTENT_FORMATS already have a
// ContentPiece for it, and generates the missing ones via Claude using
// Daniel's writing voice (see writing-voice skill — system prompt below
// keeps the same constraints inline so workers don't depend on a Skill at
// runtime).
//
// Pure narratives (no proof point) are handled by passing `narrative=...`
// without a ProofPoint id. The core narrative list lives in
// command-center-config.ts; this worker generates one ContentPiece per
// (narrative, format) for any narratives passed via opts.narratives.
//
// Spec: ../../../morning-command-center-spec.md §SYSTEM 3
// Schedule: weekly (Monday 7am) or on-demand via admin API.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'
import {
  CONTENT_FORMATS,
  FORMAT_CONSTRAINTS,
  NARRATIVES,
  type ContentFormat,
  type Narrative,
} from '../lib/command-center-config.js'

const MODEL = process.env.CONTENT_MULTIPLIER_MODEL ?? 'claude-sonnet-4-6'
const MAX_GENERATIONS_PER_RUN = 60

// Mirrors the writing-voice skill at a high level. We deliberately do NOT
// reference the skill at runtime (skills are a Claude Code concept, not a
// server primitive). Keep the constraints terse — long voice prompts cost
// tokens on every generation.
const SYSTEM_PROMPT = `
You write content in Daniel Fox's voice.

Daniel is a music producer who works the floor at a retail clothing store in
Denver. He built Entuned, an AI that composes original music for retail
stores. He writes the way someone who actually works in the store talks — not
the way a SaaS founder writes a marketing post.

Voice rules:
- Concrete details over abstractions. "She grabbed another shirt off the rack"
  not "improved purchase behavior."
- Specific numbers credible. 18% to 28% conversion. 4 hour loop for 18 months.
- One observation per piece. Don't pile up claims.
- Earned, not promoted. Don't sell. Show what happened.
- Never use: leverage, utilize, streamline, game-changer, ROI, drive sales,
  unlock, empower, revolutionary, disrupt, optimize, solution.
- Plain sentences. Short paragraphs. No headers unless the format demands it.

The user message gives you:
1. The narrative or proof point (the WHY)
2. The target format and its constraints (the HOW)

You output ONLY the finished piece. No preamble, no explanation, no signoff.
`.trim()

export interface GenerateInput {
  narrative: string
  format: ContentFormat
  proofPoint?: {
    label: string
    quoteText: string
    attribution: string
    context: string | null
  }
}

export function buildUserMessage(input: GenerateInput): string {
  const c = FORMAT_CONSTRAINTS[input.format]
  const limit = c.maxWords ? `${c.maxWords} words max` : `${c.maxChars} characters max`
  const lines = [
    `Narrative: ${input.narrative}`,
    `Format: ${input.format}`,
    `Constraint: ${limit}`,
    `Style: ${c.style}`,
    '',
  ]
  if (input.proofPoint) {
    lines.push(`Proof point label: ${input.proofPoint.label}`)
    lines.push(`Quote: "${input.proofPoint.quoteText}"`)
    lines.push(`Attribution: ${input.proofPoint.attribution}`)
    if (input.proofPoint.context) lines.push(`Context: ${input.proofPoint.context}`)
  }
  lines.push('', 'Write the piece. Output the finished piece only — no preamble.')
  return lines.join('\n')
}

export async function generateContent(
  client: Anthropic,
  input: GenerateInput,
): Promise<string | null> {
  const c = FORMAT_CONSTRAINTS[input.format]
  const maxTokens = c.maxChars ? 200 : Math.min(4000, (c.maxWords ?? 300) * 4)
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0.7,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  })
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  return text || null
}

export interface MultiplierResult {
  generated: number
  skipped: number
  failed: number
}

export async function runContentMultiplier(opts?: {
  apiKey?: string
  /** Only generate for these proof point IDs (default: all). */
  proofPointIds?: string[]
  /** Pure narratives (no ProofPoint linkage) to also generate for. */
  narratives?: Narrative[]
  /** Only generate these formats (default: all). */
  formats?: ContentFormat[]
}): Promise<MultiplierResult> {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
  const client = new Anthropic({ apiKey })
  const formats = opts?.formats ?? [...CONTENT_FORMATS]

  let generated = 0
  let skipped = 0
  let failed = 0

  const proofPoints = await prisma.proofPoint.findMany({
    where: opts?.proofPointIds ? { id: { in: opts.proofPointIds } } : undefined,
    include: { pieces: { select: { format: true } } },
  })

  for (const pp of proofPoints) {
    const have = new Set(pp.pieces.map((p) => p.format))
    for (const fmt of formats) {
      if (have.has(fmt)) { skipped++; continue }
      if (generated >= MAX_GENERATIONS_PER_RUN) return { generated, skipped, failed }
      try {
        const body = await generateContent(client, {
          narrative: pp.label,
          format: fmt,
          proofPoint: {
            label: pp.label,
            quoteText: pp.quoteText,
            attribution: pp.attribution,
            context: pp.context,
          },
        })
        if (!body) { failed++; continue }
        await prisma.contentPiece.create({
          data: {
            proofPointId: pp.id,
            narrative: pp.label,
            format: fmt,
            body,
            status: 'draft',
          },
        })
        generated++
      } catch (e) {
        console.warn(`[content-multiplier] ${pp.label}/${fmt} failed: ${(e as Error).message}`)
        failed++
      }
    }
  }

  // Pure narratives (no proof point). For each, count existing pieces by
  // format and fill the gaps.
  const pureNarratives = opts?.narratives ?? []
  for (const narrative of pureNarratives) {
    if (!NARRATIVES.includes(narrative)) continue
    const existing = await prisma.contentPiece.findMany({
      where: { narrative, proofPointId: null },
      select: { format: true },
    })
    const have = new Set(existing.map((e) => e.format))
    for (const fmt of formats) {
      if (have.has(fmt)) { skipped++; continue }
      if (generated >= MAX_GENERATIONS_PER_RUN) return { generated, skipped, failed }
      try {
        const body = await generateContent(client, { narrative, format: fmt })
        if (!body) { failed++; continue }
        await prisma.contentPiece.create({
          data: {
            proofPointId: null,
            narrative,
            format: fmt,
            body,
            status: 'draft',
          },
        })
        generated++
      } catch (e) {
        console.warn(`[content-multiplier] ${narrative}/${fmt} failed: ${(e as Error).message}`)
        failed++
      }
    }
  }

  return { generated, skipped, failed }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runContentMultiplier()
    .then((r) => console.log('[content-multiplier] done', r))
    .catch((err) => {
      console.error('[content-multiplier] failed', err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
