// Mars Style Router v1 — extractive LLM-backed routing of a StyleAnalysis into
// Suno's style field, ≤250 chars, 7 fixed slots.
//
// Why this exists: the legacy template (style-template-v1) concatenates 6 freeform
// decomposer fields with ", " and caps at 950. Synonym-stacking ("earnest", "doleful",
// "plaintive", "tender" all together) pulls Suno toward the genre centroid. Across
// ICPs, two distinct reference tracks produce near-identical style strings.
//
// The router fixes that by selecting one descriptor per dimension. Strictly extractive:
// the model is constrained to use only words that appear in the source StyleAnalysis,
// preventing invention of new descriptors and keeping the output traceable.
//
// Slots (target ~30-40 chars each, hard total cap 250):
//   1. vocal           — character + delivery (front-loaded, Suno weights early tokens)
//   2. genre_era       — specific subgenre + era anchor
//   3. heroes          — 1-2 distinctive instruments
//   4. harmonic_tempo  — harmonic color + tempo feel (numeric BPM lives elsewhere)
//   5. production      — concrete texture (tape hiss, room bleed), not abstract mood
//   6. rhythm_feel     — only if non-obvious for the genre, else empty
//
// Mood used to be a 7th slot here. Removed in router v2 — the outcome-factor
// prepend already owns mood and a duplicate router mood produced contradictions
// in the final style string. The outcome wins on mood; the router stays mood-blind.
//
// Output shape matches assembleStylePortion (a single string). Mars's other concerns
// (negative style, vocal gender, exclusion rules) are unchanged.

import Anthropic from '@anthropic-ai/sdk'
import type { StyleAnalysis } from '@prisma/client'
import { stripForSuno } from './sanitize.js'
import { prisma } from '../../db.js'

// Un-pinned alias — picks up minor model improvements automatically. Pin via
// MARS_ROUTER_MODEL env if reproducibility matters for a given experiment.
const MODEL = process.env.MARS_ROUTER_MODEL ?? 'claude-haiku-4-5'
// v2 removes the `mood` slot. Mood is owned exclusively by the outcome-factor
// prepend (eno.applyOutcomeFactorPrompt) — having the router emit a *second*
// mood word produced two-mood contradictions in the final style string
// ("chill, 78bpm, major, …, melancholy"). The outcome wins on mood.
const ROUTER_VERSION = 2
const HARD_CAP = 250

function decadeFromYear(year: number): string {
  const d = Math.floor(year / 10) * 10
  return `${d}s`
}

/** Cap at the last comma (or whitespace) inside `max` — never mid-word, never mid-slot. */
function softCap(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastComma = cut.lastIndexOf(',')
  const lastSpace = cut.lastIndexOf(' ')
  const breakAt = lastComma > max * 0.6 ? lastComma : (lastSpace > max * 0.6 ? lastSpace : max)
  return cut.slice(0, breakAt).replace(/[,\s]+$/, '')
}

// DB-backed prompt loader. Mirrors getOrSeedAnchorPrompt in style-anchor.ts
// and the LyricDraftPrompt / LyricEditPrompt pattern in bernie/. Cold-starts
// v1 from the TS seed on first call; thereafter always reads the latest
// version from the styleRouterPrompt table.
export async function getOrSeedRouterPrompt(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.styleRouterPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.styleRouterPrompt.create({
    data: {
      version: 1,
      promptText: STYLE_ROUTER_SYSTEM_PROMPT_SEED,
      notes: 'Auto-seeded v1 (migrated from TS const STYLE_ROUTER_SYSTEM_PROMPT_SEED).',
    },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}

export function getRouterVersion(): number {
  return ROUTER_VERSION
}

interface RouterSlots {
  vocal: string
  genre_era: string
  heroes: string
  harmonic_tempo: string
  production: string
  rhythm_feel: string
}

// Cold-start seed only — used when the StyleRouterPrompt table is empty on
// first run. Once getOrSeedRouterPrompt() has inserted v1, runtime ALWAYS
// reads from the DB and this const is never consulted again. Edit prompts
// through Dash → Prompts & Rules → Mars Prompts, NOT here.
export const STYLE_ROUTER_SYSTEM_PROMPT_SEED = `You are a Suno-prompt slotter. You receive a musicological decomposition of a single reference track and produce 6 short slot strings that compose into a Suno style field.

Suno is a music-generation model. It grounds well on technical, genre-tag, and gear vocabulary. It does NOT ground on literary or affect-laden adjectives. Your job is to translate the decomposer's prose (which often contains both) into the Suno-readable subset only, with strict per-slot discipline.

Mood is set elsewhere by the outcome — DO NOT emit any mood word, affect word, or feeling adjective in any slot. If the decomposer's prose contains affect, demote to neutral technical language or omit.

# Hard rules

1. EXTRACTIVE OR DEMOTE. Every content word you emit must either (a) appear in the source decomposition or Track metadata, or (b) be a direct technical synonym for a literary term in the source (e.g., source says "doleful croon" → emit "tenor lead" or "baritone lead" if register is given; if no register is given, drop the affect entirely and emit "male lead"). NEVER infer era from genre — use the decade from Track metadata verbatim.

2. SUNO-READABLE LANGUAGE ONLY. Allowed: vocal registers (tenor, baritone, alto, soprano, falsetto, head voice, chest voice), techniques (fingerpicked, strummed, slapped, picked, brushed, swept, palm-muted), mic positions (close-mic, room-mic, distant), production methods (lo-fi, polished, home-recorded, tape, DAW, dry, wet, reverb-soaked, phased, compressed), specific subgenre + decade (e.g., "late-2000s indie folk"), instrument names, harmonic terms (modal, diatonic, chromatic, major-key, minor-key, extended chords), tempo terms (mid-tempo, uptempo, downtempo). FORBIDDEN: literary affect (doleful, plaintive, surefooted, earnest, communal, literary, aspirational, hymnal, pastoral, fairy-tale, liturgical, conversational, intimate-as-affect), mood/affect words of any kind (melancholy, uplifting, menacing, tender, joyful, dark, bright, warm-as-mood — these belong to the outcome, not the router), metaphor (cinematic, painterly, dreamlike), aesthetic posture words (sophisticated, refined, raw-as-affect). If a literary or affect term has no clear technical substitute, OMIT it.

3. ONE DESCRIPTOR PER SLOT. NO COMMAS inside any slot value. Each slot is a single short phrase. If you find yourself stacking with commas, you are violating this rule — pick the single most Suno-actionable phrase and discard the rest.

4. NO temporal/arrangement language in any slot. Words like "builds", "drops", "enters", "fades", "bridge", "verse", "outro", "stripped" do not belong here.

# The 6 slots and their hard ceilings

vocal (≤30 chars, no commas): register + ONE technical qualifier. Example: "tenor male lead", "falsetto male", "baritone with vibrato". If source gives no register, emit "male lead" / "female lead". DO NOT use "croon", "doleful", "plaintive", "earnest" here.
genre_era (≤30 chars, no commas): subgenre + decade. Example: "late-2000s indie folk", "mid-2010s neo-soul". One subgenre. No "hymnal", "pastoral", "literary".
heroes (≤35 chars, no commas): 1-2 instruments joined by "and". Example: "fingerpicked acoustic and brushed drums". No descriptive verbs ("leading", "anchoring").
harmonic_tempo (≤35 chars, no commas): harmonic color + tempo feel as one phrase. Example: "modal diatonic mid-tempo", "chromatic extended chords mid-tempo".
production (≤30 chars, no commas): one production texture. Example: "dry close-mic with room bleed", "phased stereo bass". One concrete texture.
rhythm_feel (≤20 chars, no commas): ONLY if source calls out a non-obvious rhythm character (swung, behind-the-beat, on-the-grid). Else empty string "".

# Output

Return a single JSON object with exactly these keys: vocal, genre_era, heroes, harmonic_tempo, production, rhythm_feel. No prose. No code fences. All values are strings (rhythm_feel may be empty).`

export interface RouterContext {
  /** Track release year — authoritative for era anchoring. */
  year?: number | null
  /** Override decade (e.g., "1970s"). Defaults to decade derived from year. */
  decade?: string | null
}

function buildUserMessage(d: StyleAnalysis, ctx: RouterContext): string {
  const decade =
    ctx.decade ??
    (typeof ctx.year === 'number' ? decadeFromYear(ctx.year) : null)
  const meta: string[] = []
  if (typeof ctx.year === 'number') meta.push(`year: ${ctx.year}`)
  if (decade) meta.push(`decade: ${decade}`)
  const metaBlock = meta.length > 0
    ? `# Track metadata (authoritative — use the decade verbatim in genre_era; do NOT infer era from genre)\n\n${meta.join('\n')}\n\n`
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
  return `${metaBlock}# Source decomposition\n\n${blocks.join('\n\n')}\n\n# Task\n\nProduce the 7 slots per the rules. Output JSON only.`
}

function validate(s: any): asserts s is RouterSlots {
  const required = ['vocal', 'genre_era', 'heroes', 'harmonic_tempo', 'production', 'rhythm_feel']
  for (const k of required) {
    if (typeof s?.[k] !== 'string') throw new Error(`Router output missing or non-string slot: ${k}`)
  }
}

function composeStyle(slots: RouterSlots): string {
  const ordered = [
    slots.vocal,
    slots.genre_era,
    slots.heroes,
    slots.harmonic_tempo,
    slots.production,
    slots.rhythm_feel,
  ]
  const joined = ordered
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(', ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
  // Soft-cap on word/comma boundary so we never chop a slot mid-phrase.
  return softCap(stripForSuno(joined), HARD_CAP)
}

export interface RouterResult {
  style: string
  slots: RouterSlots
  routerVersion: number
  modelId: string
}

export async function routeStylePortion(
  decomposition: StyleAnalysis,
  ctx: RouterContext = {},
): Promise<RouterResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    // Extractive slot-routing — low temperature improves consistency.
    // tool_choice forces structured output, so we no longer need a stop
    // sequence to cut prose tails.
    temperature: 0.3,
    system: [
      {
        type: 'text',
        text: (await getOrSeedRouterPrompt()).promptText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserMessage(decomposition, ctx) }],
    tools: [
      {
        name: 'emit_slots',
        description:
          'Emit the 6 routed slot strings that compose into the Suno style field. Mood is set by the outcome layer — do not emit a mood word.',
        input_schema: {
          type: 'object',
          properties: {
            vocal: { type: 'string' },
            genre_era: { type: 'string' },
            heroes: { type: 'string' },
            harmonic_tempo: { type: 'string' },
            production: { type: 'string' },
            rhythm_feel: {
              type: 'string',
              description:
                'Empty string if the source does not call out a non-obvious rhythm character.',
            },
          },
          required: [
            'vocal',
            'genre_era',
            'heroes',
            'harmonic_tempo',
            'production',
            'rhythm_feel',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_slots' },
  })

  const toolUse = response.content.find(
    (b: any) => b.type === 'tool_use' && (b as any).name === 'emit_slots',
  ) as any
  if (!toolUse) throw new Error('Router did not emit tool_use')
  const slots = toolUse.input as RouterSlots
  try {
    validate(slots)
  } catch (e) {
    console.error('--- router tool_use input (validation failed) ---')
    console.error(JSON.stringify(toolUse.input))
    console.error('--- end tool_use input ---')
    throw e
  }

  return {
    style: composeStyle(slots),
    slots,
    routerVersion: ROUTER_VERSION,
    modelId: response.model,
  }
}
