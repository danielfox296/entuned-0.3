// The Music Professor — finishing editor for the Mars style + negativeStyle
// portion of a song prompt.
//
// Runs between Mars's assemble and eno's applyOutcomeFactorPrompt wrap.
// Reads (style, negativeStyle) through a tunable craft curriculum and
// brings them to final standard while preserving Mars's anchor and
// vocal-gender carry. Single Anthropic call.
//
// The persona is a versioned system prompt; the curriculum is a CRUD'd
// list of craft modules — both DB-backed and editable in Dash → Engine →
// Music Professor. A separate GenreGravityRule table feeds the
// genre-gravity curriculum module.
//
// Safety: if the model strips the genre anchor, returns empty fields,
// refuses to emit the tool response, or blows past the hard caps, the
// runner falls back to Mars's input unchanged. The provenance fields on
// SongSeed capture the pre-MusicProfessor style and the persona version
// used. Like the Lyric Professor, this layer must never block seed
// generation.

import Anthropic from '@anthropic-ai/sdk'
import {
  getOrSeedPersona,
  loadActiveModules,
  loadGenreGravityRules,
  formatCurriculumBlock,
  formatGenreGravityBlock,
} from './_helpers.js'

const MODEL = process.env.MUSIC_PROFESSOR_MODEL ?? process.env.PROFESSOR_MODEL ?? 'claude-sonnet-4-6'

// Hard caps. Positive style cap is well below SUNO_STYLE_CAP (1000) since
// applyOutcomeFactorPrompt prepends ~40 chars and Mars's actual output runs
// ~60 chars — even 240 leaves enormous headroom.
//
// Negative-style cap is INTENTIONALLY higher than Mars's NEGATIVE_STYLE_HARD_CAP
// of 400. Mars routinely produces negativeStyle right at its cap (verified
// 2026-05-26: 383-400 chars across recent seeds), so an MP cap equal to Mars's
// would force fallback on every seed the moment module 1 added a single era-
// exclusion term. We give MP ~100 chars of additive headroom. Total stays well
// under Suno's negative-style accept-box (commonly cited 500-1000 range).
const STYLE_HARD_CAP = 240
const NEGATIVE_STYLE_HARD_CAP = 500

const EMIT_POLISHED_STYLE_TOOL: Anthropic.Tool = {
  name: 'emit_polished_style',
  description: 'Emit the polished style + negativeStyle and the change log naming which curriculum modules triggered each change.',
  input_schema: {
    type: 'object',
    properties: {
      style: {
        type: 'string',
        description: 'The polished positive style. Comma-separated tags. Hard cap 240 chars. Must NOT contain "vocal", vocal-gender words, or arrangement words (verse/chorus/bridge).',
      },
      negativeStyle: {
        type: 'string',
        description: 'The polished negative style. Comma-separated tags. Hard cap 500 chars.',
      },
      changeLog: {
        type: 'array',
        items: { type: 'string' },
        description: 'For each module that triggered a change, a short tag naming it. Max 6 entries. Empty array if no changes were made.',
      },
    },
    required: ['style', 'negativeStyle'],
  },
}

export interface MusicProfessorInput {
  /** Post-Mars positive style. The Music Professor's input. */
  style: string
  /** Post-Mars negative style. The Music Professor's input. */
  negativeStyle: string
  /** Mars's chosen genre anchor tag, if the anchor builder was used. Lets the
   *  runner verify the polished style still contains the anchor. */
  anchorTag?: string | null
}

export interface MusicProfessorOutput {
  /** The polished positive style. May equal input.style if the runner declined or fell back. */
  style: string
  /** The polished negative style. May equal input.negativeStyle if the runner declined or fell back. */
  negativeStyle: string
  /** Version of the persona row used for this pass. Carried onto SongSeed for provenance. */
  personaVersion: number
  /** Tags emitted by the persona's per-change audit. Stored on SongSeed for operator review. */
  changeLog: string[]
  /** True iff a safety fallback fired. */
  fellBack: boolean
  /** Reason for the fallback, when one fired. */
  fallbackReason?:
    | 'tool_refusal'
    | 'empty_style'
    | 'anchor_dropped'
    | 'style_overflow'
    | 'negative_style_overflow'
    | 'banned_token_present'
}

// Word-boundary check for tokens Suno reads as instructional. These must
// never appear in positive style. Same list as the anti-prompt-bleed
// module; enforced here as a hard safety net so a misbehaving model
// can't sneak them through.
const BANNED_POSITIVE_TOKENS = [
  'vocal',
  'vocals',
  'song about',
  'verse',
  'chorus',
  'bridge',
  'intro',
  'outro',
  'lyric',
  'lyrics',
]

function containsBannedToken(style: string): boolean {
  const lower = style.toLowerCase()
  for (const t of BANNED_POSITIVE_TOKENS) {
    // word-boundary match — "verseatile" should not trip "verse"
    const re = new RegExp(`(^|[^a-z])${t.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i')
    if (re.test(lower)) return true
  }
  return false
}

export async function runMusicProfessor(input: MusicProfessorInput): Promise<MusicProfessorOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const [persona, modules, gravityRules] = await Promise.all([
    getOrSeedPersona(),
    loadActiveModules(),
    loadGenreGravityRules(),
  ])

  const curriculumBlock = formatCurriculumBlock(modules)
  const gravityBlock = formatGenreGravityBlock(gravityRules)
  const systemPrompt = `${persona.promptText}${curriculumBlock}${gravityBlock}`

  const userMessage = `Polish this style portion. Preserve the genre anchor and the load-bearing instruments verbatim. Apply the curriculum and emit the polished output via the tool.

style: ${input.style}
negativeStyle: ${input.negativeStyle}`

  let toolInput: { style?: string; negativeStyle?: string; changeLog?: string[] } | null = null
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      tools: [EMIT_POLISHED_STYLE_TOOL],
      tool_choice: { type: 'tool', name: 'emit_polished_style' },
    })
    const toolUse = response.content.find((b: any) => b.type === 'tool_use' && (b as any).name === 'emit_polished_style') as any
    if (toolUse) toolInput = toolUse.input as { style?: string; negativeStyle?: string; changeLog?: string[] }
  } catch {
    // Network / API error — fall back to the Mars input. The Music Professor
    // is an additive polish layer and must not block seed generation.
    toolInput = null
  }

  const fallback = (reason: MusicProfessorOutput['fallbackReason']): MusicProfessorOutput => ({
    style: input.style,
    negativeStyle: input.negativeStyle,
    personaVersion: persona.version,
    changeLog: [],
    fellBack: true,
    fallbackReason: reason,
  })

  if (!toolInput) return fallback('tool_refusal')
  if (typeof toolInput.style !== 'string' || toolInput.style.trim().length === 0) return fallback('empty_style')
  if (typeof toolInput.negativeStyle !== 'string') return fallback('empty_style')

  const polishedStyle = toolInput.style.trim()
  const polishedNegative = toolInput.negativeStyle.trim()

  // Anchor preservation: if Mars chose a genre anchor, the polished style
  // must still contain it (case-insensitive). Stripping the anchor would
  // change Suno's centroid entirely — fall back rather than ship.
  if (input.anchorTag && input.anchorTag.trim().length > 0) {
    if (!polishedStyle.toLowerCase().includes(input.anchorTag.toLowerCase())) {
      return fallback('anchor_dropped')
    }
  }

  // Cap enforcement. The tool description states the caps, but a misbehaving
  // model can still overshoot — fall back rather than silently truncate
  // (truncation could lop the anchor off the tail).
  if (polishedStyle.length > STYLE_HARD_CAP) return fallback('style_overflow')
  if (polishedNegative.length > NEGATIVE_STYLE_HARD_CAP) return fallback('negative_style_overflow')

  // Banned-token check: the curriculum tells the model not to introduce
  // instructional words; this is the hard safety net.
  if (containsBannedToken(polishedStyle)) return fallback('banned_token_present')

  const changeLog = Array.isArray(toolInput.changeLog)
    ? toolInput.changeLog.filter((t) => typeof t === 'string' && t.trim().length > 0).slice(0, 6)
    : []

  return {
    style: polishedStyle,
    negativeStyle: polishedNegative,
    personaVersion: persona.version,
    changeLog,
    fellBack: false,
  }
}
