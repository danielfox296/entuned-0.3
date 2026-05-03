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
//   7. mood            — ONE word, no synonyms
//
// Output shape matches assembleStylePortion (a single string). Mars's other concerns
// (negative style, vocal gender, exclusion rules) are unchanged.

import Anthropic from '@anthropic-ai/sdk'
import type { StyleAnalysis } from '@prisma/client'
import { stripForSuno } from './sanitize.js'

const MODEL = process.env.MARS_ROUTER_MODEL ?? 'claude-haiku-4-5-20251001'
const ROUTER_VERSION = 1
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
  mood: string
}

const SYSTEM_PROMPT = `You are a Suno-prompt slotter. You receive a musicological decomposition of a single reference track and produce 7 short slot strings that compose into a Suno style field.

Suno is a music-generation model. It grounds well on technical, genre-tag, and gear vocabulary. It does NOT ground on literary or affect-laden adjectives. Your job is to translate the decomposer's prose (which often contains both) into the Suno-readable subset only, with strict per-slot discipline.

# Hard rules

1. EXTRACTIVE OR DEMOTE. Every content word you emit must either (a) appear in the source decomposition or Track metadata, or (b) be a direct technical synonym for a literary term in the source (e.g., source says "doleful croon" → emit "tenor lead" or "baritone lead" if register is given; if no register is given, drop the affect entirely and emit "male lead"). NEVER infer era from genre — use the decade from Track metadata verbatim.

2. SUNO-READABLE LANGUAGE ONLY in slots 1-6. Allowed: vocal registers (tenor, baritone, alto, soprano, falsetto, head voice, chest voice), techniques (fingerpicked, strummed, slapped, picked, brushed, swept, palm-muted), mic positions (close-mic, room-mic, distant), production methods (lo-fi, polished, home-recorded, tape, DAW, dry, wet, reverb-soaked, phased, compressed), specific subgenre + decade (e.g., "late-2000s indie folk"), instrument names, harmonic terms (modal, diatonic, chromatic, major-key, minor-key, extended chords), tempo terms (mid-tempo, uptempo, downtempo). FORBIDDEN: literary affect (doleful, plaintive, surefooted, earnest, communal, literary, aspirational, hymnal, pastoral, fairy-tale, liturgical, conversational, intimate-as-affect), metaphor (cinematic, painterly, dreamlike), aesthetic posture words (sophisticated, refined, raw-as-affect). If a literary term has no clear technical substitute, OMIT it.

3. ONE DESCRIPTOR PER SLOT. NO COMMAS inside any slot value. Each slot is a single short phrase. If you find yourself stacking with commas, you are violating this rule — pick the single most Suno-actionable phrase and discard the rest.

4. NO temporal/arrangement language in any slot. Words like "builds", "drops", "enters", "fades", "bridge", "verse", "outro", "stripped" do not belong here.

5. Front-load the vocal slot.

6. The mood slot is the ONLY place a literary affect word is permitted, and it must be a single word.

# The 7 slots and their hard ceilings

vocal (≤30 chars, no commas): register + ONE technical qualifier. Example: "tenor male lead", "falsetto male", "baritone with vibrato". If source gives no register, emit "male lead" / "female lead". DO NOT use "croon", "doleful", "plaintive", "earnest" here.
genre_era (≤30 chars, no commas): subgenre + decade. Example: "late-2000s indie folk", "mid-2010s neo-soul". One subgenre. No "hymnal", "pastoral", "literary".
heroes (≤35 chars, no commas): 1-2 instruments joined by "and". Example: "fingerpicked acoustic and brushed drums". No descriptive verbs ("leading", "anchoring").
harmonic_tempo (≤35 chars, no commas): harmonic color + tempo feel as one phrase. Example: "modal diatonic mid-tempo", "chromatic extended chords mid-tempo".
production (≤30 chars, no commas): one production texture. Example: "dry close-mic with room bleed", "phased stereo bass". One concrete texture.
rhythm_feel (≤20 chars, no commas): ONLY if source calls out a non-obvious rhythm character (swung, behind-the-beat, on-the-grid). Else empty string "".
mood (≤12 chars): ONE word. Example: "melancholy", "uplifting", "menacing", "tender".

# Output

Return a single JSON object with exactly these keys: vocal, genre_era, heroes, harmonic_tempo, production, rhythm_feel, mood. No prose. No code fences. All values are strings (rhythm_feel may be empty).`

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

function extractJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1) return trimmed
  return trimmed.slice(start, end + 1)
}

function validate(s: any): asserts s is RouterSlots {
  const required = ['vocal', 'genre_era', 'heroes', 'harmonic_tempo', 'production', 'rhythm_feel', 'mood']
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
    slots.mood,
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
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserMessage(decomposition, ctx) }],
  })

  const textBlocks = response.content.filter((b: any) => b.type === 'text') as any[]
  if (textBlocks.length === 0) throw new Error('Router returned no text content')
  const raw = textBlocks[textBlocks.length - 1].text as string

  const cleaned = extractJson(raw)
  let slots: RouterSlots
  try {
    const parsed = JSON.parse(cleaned)
    validate(parsed)
    slots = parsed
  } catch (e) {
    console.error('--- router raw output (parse failed) ---')
    console.error(raw)
    console.error('--- end raw output ---')
    throw e
  }

  return {
    style: composeStyle(slots),
    slots,
    routerVersion: ROUTER_VERSION,
    modelId: response.model,
  }
}
