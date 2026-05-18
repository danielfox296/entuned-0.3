// Mars Style Anchor v1 — "Anchor-and-Carve" parallel builder.
//
// Why this exists: live Suno testing (2026-05-10) showed Suno reads genre tags as
// the dominant signal and ignores ~90% of technical vocabulary. The router builder
// (style-router.ts) produces precise prompts that mostly get ignored. The anchor
// builder operates the actual steering wheel:
//   1. Pick a genre tag whose CENTROID points at the right family (not the literal
//      label — "yacht rock" collapses to Christopher Cross, but "1970s jazz-rock"
//      carries Steely Dan DNA).
//   2. Add 0-2 surgical positive corrections inside the genre.
//   3. Hand a curated list of sub-attractors to the negative-style field, which is
//      the primary tool for carving unwanted attractors out of a genre cluster.
//
// Output shape mirrors RouterResult but adds negativeAdditions — the anchor strategy
// participates in negative-style construction. Mars merges these into the rule-fired
// negative-style output so the existing protections are preserved.
//
// Toggle via STYLE_BUILDER=anchor (env). Defaults to router.

import Anthropic from '@anthropic-ai/sdk'
import type { StyleAnalysis } from '@prisma/client'
import { stripForSuno } from './sanitize.js'
import { capStyle } from './cap.js'

// Un-pinned alias — picks up minor model improvements automatically. Pin via
// MARS_ANCHOR_MODEL env if reproducibility matters for a given experiment.
const MODEL = process.env.MARS_ANCHOR_MODEL ?? 'claude-haiku-4-5'
const ANCHOR_VERSION = 1
const STYLE_HARD_CAP = 250

interface AnchorPick {
  anchor: string
  corrections: string[]
  sub_attractors: string[]
}

const SYSTEM_PROMPT = `You are picking Suno style parameters for one reference track. Suno is genre-tag driven — it reads genre tags as the dominant signal and ignores most technical vocabulary. Your job is to pick three things.

1. ANCHOR: one genre tag (subgenre + decade) whose CENTROID points at the right family for this track. NOT the literal genre label if that label's Suno-training centroid is a famously generic artist. Examples:
   - "yacht rock" collapses to Christopher Cross. For a Steely Dan track, "1970s jazz-rock" is better because jazz-rock's centroid carries Steely Dan DNA.
   - "neo-soul" collapses to D'Angelo. For most neo-soul-adjacent tracks pick the closest functional cousin.
   Pair subgenre with decade ("1970s jazz-rock", "late-2000s indie folk"). One phrase, no comma stacks.

2. CORRECTIONS: 0-2 short surgical positive phrases (≤30 chars each) that nudge sub-elements inside the chosen genre. Use ONLY when the genre's internal default has known drift this track doesn't want. Example: "jazz guitar solo" inside "1970s jazz-rock" counters the genre's default virtuoso-rock-guitar attractor. Do NOT describe what the genre already gets right. If no corrections are needed, return an empty list.

3. SUB_ATTRACTORS: 4-10 specific things from inside the chosen genre's centroid that should NOT appear in the output. These go into Suno's negative-style field, which is the primary tool for carving unwanted attractors out of a genre cluster. Be specific to the genre's internal drifts. Example for "1970s jazz-rock": ["southern accent", "twang", "blues vocal", "hard rock guitar", "virtuoso rock guitar", "swamp rock", "americana", "country rock", "southern soul", "rootsy"].

Hard rules:
- Anchor is one phrase. Never a comma stack.
- No artist, producer, studio, or gear-brand names anywhere.
- Sub-attractors target the genre's internal centroid drifts, not generic Suno contamination (a separate layer handles generic contamination).
- Decade comes from track metadata, never inferred from genre.
- If the track decomposition genuinely doesn't fit any clean genre cluster, output the closest tag and compensate with more sub_attractors.

Return a single JSON object with these exact keys: { "anchor": "...", "corrections": ["..."], "sub_attractors": ["...", "..."] }. No prose. No code fences.`

function decadeFromYear(year: number): string {
  const d = Math.floor(year / 10) * 10
  return `${d}s`
}

export interface AnchorContext {
  /** Track release year — authoritative for decade anchoring. */
  year?: number | null
}

function buildUserMessage(d: StyleAnalysis, ctx: AnchorContext): string {
  const decade = typeof ctx.year === 'number' ? decadeFromYear(ctx.year) : null
  const meta: string[] = []
  if (typeof ctx.year === 'number') meta.push(`year: ${ctx.year}`)
  if (decade) meta.push(`decade: ${decade}`)
  const metaBlock =
    meta.length > 0
      ? `# Track metadata (authoritative — use the decade verbatim in the anchor)\n${meta.join('\n')}\n\n`
      : ''

  const fields: Array<[string, string | null]> = [
    ['vibe_pitch', d.vibePitch],
    ['era_production_signature', d.eraProductionSignature],
    ['instrumentation_palette', d.instrumentationPalette],
    ['standout_element', d.standoutElement],
    ['vocal_character', d.vocalCharacter],
    ['vocal_arrangement', d.vocalArrangement],
    ['harmonic_and_groove', d.harmonicAndGroove],
  ]
  const blocks = fields
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `## ${k}\n${v!.trim()}`)

  return `${metaBlock}# Source decomposition\n\n${blocks.join('\n\n')}\n\n# Task\n\nPick anchor, corrections, and sub_attractors per the rules. JSON only.`
}

function validate(p: any): asserts p is AnchorPick {
  if (typeof p?.anchor !== 'string' || p.anchor.trim().length === 0) {
    throw new Error('Anchor missing or empty')
  }
  if (!Array.isArray(p.corrections)) p.corrections = []
  if (!Array.isArray(p.sub_attractors)) p.sub_attractors = []
  p.corrections = p.corrections.filter((s: any) => typeof s === 'string' && s.trim().length > 0)
  p.sub_attractors = p.sub_attractors.filter((s: any) => typeof s === 'string' && s.trim().length > 0)
}

function composeStyle(pick: AnchorPick): string {
  const parts = [pick.anchor, ...pick.corrections.slice(0, 2)]
  const joined = parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(', ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
  return capStyle(stripForSuno(joined), STYLE_HARD_CAP)
}

export function getAnchorVersion(): number {
  return ANCHOR_VERSION
}

export interface AnchorResult {
  /** The composed positive-style string. */
  style: string
  /** The picked genre tag (for provenance). */
  anchor: string
  /** Any surgical positive corrections (for provenance). */
  corrections: string[]
  /** Sub-attractors the anchor wants merged into negative-style. */
  negativeAdditions: string[]
  anchorVersion: number
  modelId: string
}

export async function buildAnchorStyle(
  decomposition: StyleAnalysis,
  ctx: AnchorContext = {},
): Promise<AnchorResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    // Anchor picking is extractive over a small vocabulary — low temperature
    // reduces drift across repeat calls. tool_choice forces structured output,
    // so we no longer need a stop sequence to cut prose tails.
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserMessage(decomposition, ctx) }],
    tools: [
      {
        name: 'emit_anchor',
        description:
          'Emit the chosen Suno anchor genre tag, surgical corrections, and sub-attractors for the negative-style field.',
        input_schema: {
          type: 'object',
          properties: {
            anchor: {
              type: 'string',
              description:
                'One genre tag whose centroid points at the right family. Subgenre + decade.',
            },
            corrections: {
              type: 'array',
              items: { type: 'string' },
              description: '0-2 short surgical positive phrases.',
            },
            sub_attractors: {
              type: 'array',
              items: { type: 'string' },
              description: '4-10 specific things to exclude via negative-style.',
            },
          },
          required: ['anchor', 'corrections', 'sub_attractors'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_anchor' },
  })

  const toolUse = response.content.find(
    (b: any) => b.type === 'tool_use' && (b as any).name === 'emit_anchor',
  ) as any
  if (!toolUse) throw new Error('Anchor did not emit tool_use')
  const pick = toolUse.input as AnchorPick
  try {
    validate(pick)
  } catch (e) {
    console.error('--- anchor tool_use input (validation failed) ---')
    console.error(JSON.stringify(toolUse.input))
    console.error('--- end tool_use input ---')
    throw e
  }

  return {
    style: composeStyle(pick),
    anchor: pick.anchor,
    corrections: pick.corrections,
    negativeAdditions: pick.sub_attractors,
    anchorVersion: ANCHOR_VERSION,
    modelId: response.model,
  }
}
