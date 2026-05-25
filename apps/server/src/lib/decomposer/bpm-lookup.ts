// Cheap BPM-only side route — Haiku 4.5 + one web_search call. Used by the
// backfill endpoint to fill `StyleAnalysis.bpm` on existing decompositions
// without re-running the full rules-v10 decomposer (Sonnet + 4000 max_tokens
// + the entire musicological brief regenerated for one number).
//
// Cost target: ~$0.005–0.01 per track, dominated by the search call. The
// model prompt itself is tiny.
//
// Disambiguation rules mirror rules-v10 §"Tempo extraction" — main-body
// tempo, snare/backbeat alignment (not hi-hat subdivision), null on
// unconfident sources.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'

const MODEL = process.env.BPM_LOOKUP_MODEL ?? 'claude-haiku-4-5-20251001'

// Cold-start seed only. Live prompt lives in `bpm_lookup_prompts` (DB), editable
// from Dash → Prompts & Rules → BPM Lookup. After getOrSeedBpmLookupPrompt()
// inserts v1, this const is never read at runtime.
export const BPM_LOOKUP_SYSTEM_PROMPT_SEED = `
You look up the BPM (beats per minute) for a specific song using web search.

Rules:
- Report the **main-body** tempo. If the intro or outro is at a different
  tempo than the bulk of the track, ignore the intro/outro.
- For half-time / double-time ambiguity (common in hip-hop, trap, drum-and-bass):
  report the tempo aligned with the **snare / backbeat**, not the hi-hat
  subdivision. If sources disagree by exactly 2x, pick the snare-aligned value.
- Cross-check at least two sources when the first hit is borderline.
  Reliable sources: Tunebat, songbpm.com, MusicBPM, producer-credit pages.
- If you can't find a confident BPM (obscure track, contradictory sources,
  tempo-fluid section work), set bpm: null and confidence: low.
- Return integers only. Round to the nearest integer if the source gives a decimal.

Call emit_bpm exactly once, after any web research.
`.trim()

const EMIT_BPM_TOOL: Anthropic.Tool = {
  name: 'emit_bpm',
  description: 'Emit the track tempo (BPM) and the lookup confidence.',
  input_schema: {
    type: 'object',
    properties: {
      bpm: {
        type: ['integer', 'null'] as any,
        description: 'Integer 1-300, or null when no confident source is available.',
      },
      confidence: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'How well the search resolved the tempo. Low = guess, high = multiple sources agree.',
      },
    },
    required: ['bpm', 'confidence'],
  } as any,
}

export interface BpmLookupInput {
  artist: string
  title: string
  year?: number | null
}

export interface BpmLookupResult {
  bpm: number | null
  confidence: 'low' | 'medium' | 'high'
  modelId: string
}

export async function lookupBpm(input: BpmLookupInput): Promise<BpmLookupResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const userMessage = `Track: ${input.artist} — ${input.title}${input.year ? ` (${input.year})` : ''}

Look up the BPM and call emit_bpm.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.1,
    system: [{ type: 'text', text: (await getOrSeedBpmLookupPrompt()).promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
    tools: [
      EMIT_BPM_TOOL,
      { type: 'web_search_20250305', name: 'web_search', max_uses: 1 } as any,
    ],
  })

  const emitBlock = response.content.find(
    (b: any) => b.type === 'tool_use' && b.name === 'emit_bpm',
  ) as any
  if (!emitBlock) {
    return { bpm: null, confidence: 'low', modelId: response.model }
  }

  const raw = emitBlock.input as { bpm: unknown; confidence: unknown }
  const bpm = normalizeBpm(raw.bpm)
  const confidence = normalizeConfidence(raw.confidence)
  // If the model returned a value but it failed the (0, 300] sanity range,
  // demote confidence to low — that way an operator scan flags the row.
  const finalConfidence = bpm === null && raw.bpm != null ? 'low' : confidence
  return { bpm, confidence: finalConfidence, modelId: response.model }
}

export function normalizeBpm(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  const rounded = Math.round(raw)
  if (rounded <= 0 || rounded > 300) return null
  return rounded
}

export function normalizeConfidence(raw: unknown): 'low' | 'medium' | 'high' {
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return 'low'
}

/** DB-backed prompt loader. Mirrors getOrSeedHookDrafterPrompt: inserts v1
 *  from BPM_LOOKUP_SYSTEM_PROMPT_SEED when the table is empty, then always
 *  reads the latest version. The TS const is never read at runtime after
 *  first deploy. */
export async function getOrSeedBpmLookupPrompt(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.bpmLookupPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.bpmLookupPrompt.create({
    data: {
      version: 1,
      promptText: BPM_LOOKUP_SYSTEM_PROMPT_SEED,
      notes: 'Auto-seeded v1 (migrated from TS const BPM_LOOKUP_SYSTEM_PROMPT_SEED).',
    },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}
