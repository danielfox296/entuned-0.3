// The Professor — finishing editor for song lyrics.
//
// Runs as a third pass between Bernie (draft + edit, brand voice + playability)
// and the arranger (section-marker injection). Reads the post-Bernie lyric
// through a tunable craft curriculum and brings it to final standard while
// preserving the writer's voice and the song's structure.
//
// Single Anthropic call. The persona is a versioned system prompt; the
// curriculum is a CRUD'd list of craft modules — both DB-backed and editable
// in Dash → Engine → Professor.
//
// Safety: if the model drops the hook verbatim, breaks the section markers,
// or refuses to emit the tool response, the runner falls back to the input
// lyric unchanged. The provenance fields on `SongSeed` capture the pre-
// Professor lyric and the persona version used.

import Anthropic from '@anthropic-ai/sdk'
import { getOrSeedPersona, loadActiveModules, formatCurriculumBlock } from './_helpers.js'

const MODEL = process.env.PROFESSOR_MODEL ?? process.env.LYRICIST_MODEL ?? 'claude-sonnet-4-6'

const EMIT_FINISHED_LYRIC_TOOL: Anthropic.Tool = {
  name: 'emit_finished_lyric',
  description: 'Emit the finished lyric and the change log naming which curriculum modules triggered each change.',
  input_schema: {
    type: 'object',
    properties: {
      lyrics: {
        type: 'string',
        description: 'The finished lyric with [Section] markers preserved verbatim from the input.',
      },
      changeLog: {
        type: 'array',
        items: { type: 'string' },
        description: 'For each line you changed, a short tag naming the module that triggered the change. Max 8 entries. Empty array if no changes were made.',
      },
    },
    required: ['lyrics'],
  },
}

export interface ProfessorInput {
  /** Post-Bernie lyric with [Section] markers. The Professor's input. */
  draftLyrics: string
  /** Hook text used for the preservation invariant check. */
  hookText: string
}

export interface ProfessorOutput {
  /** The finished lyric. May equal `draftLyrics` if the Professor declined to edit or fell back. */
  lyrics: string
  /** Version of the persona row used for this pass. Carried onto SongSeed for provenance. */
  personaVersion: number
  /** Tags emitted by the persona's per-change audit. Stored on SongSeed for operator review. */
  changeLog: string[]
  /** True iff a safety fallback fired (hook dropped, section markers broken, tool refusal). */
  fellBack: boolean
  /** Reason for the fallback, when one fired. */
  fallbackReason?: 'tool_refusal' | 'hook_dropped' | 'section_markers_lost' | 'empty_lyrics'
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

// Counts top-level [Section] markers (e.g., [Verse 1], [Chorus], [Bridge]).
// Used as the section-marker preservation check — the Professor must not drop
// or rename section headers.
const SECTION_MARKER_RE = /^\s*\[[^\]\n]+\]\s*$/gm

function countSectionMarkers(text: string): number {
  return (text.match(SECTION_MARKER_RE) ?? []).length
}

export async function runProfessor(input: ProfessorInput): Promise<ProfessorOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const [persona, modules] = await Promise.all([
    getOrSeedPersona(),
    loadActiveModules(),
  ])

  const curriculumBlock = formatCurriculumBlock(modules)
  const systemPrompt = `${persona.promptText}${curriculumBlock}`

  const userMessage = `Draft lyric to finish:\n\n${input.draftLyrics}\n\nApply the curriculum and emit the finished lyric via the tool. Preserve every [Section] marker verbatim. Preserve the hook line verbatim wherever it appears — that line is contractual. If the draft already reads well, change little or nothing.`

  let toolInput: { lyrics?: string; changeLog?: string[] } | null = null
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      tools: [EMIT_FINISHED_LYRIC_TOOL],
      tool_choice: { type: 'tool', name: 'emit_finished_lyric' },
    })
    const toolUse = response.content.find((b: any) => b.type === 'tool_use' && (b as any).name === 'emit_finished_lyric') as any
    if (toolUse) toolInput = toolUse.input as { lyrics?: string; changeLog?: string[] }
  } catch {
    // Network / API error — fall back to the input lyric. We deliberately do
    // not throw: the Professor is an additive polish layer and must not block
    // seed generation if the call fails.
    toolInput = null
  }

  if (!toolInput || typeof toolInput.lyrics !== 'string' || toolInput.lyrics.trim().length === 0) {
    return {
      lyrics: input.draftLyrics,
      personaVersion: persona.version,
      changeLog: [],
      fellBack: true,
      fallbackReason: !toolInput ? 'tool_refusal' : 'empty_lyrics',
    }
  }

  const finished = toolInput.lyrics

  // Hook preservation: the Professor must not drop the hook line. Mirror
  // Bernie's invariant — fall back on regression.
  const draftHookCount = countOccurrences(input.draftLyrics, input.hookText)
  const finishedHookCount = countOccurrences(finished, input.hookText)
  if (draftHookCount > 0 && finishedHookCount < draftHookCount) {
    return {
      lyrics: input.draftLyrics,
      personaVersion: persona.version,
      changeLog: [],
      fellBack: true,
      fallbackReason: 'hook_dropped',
    }
  }

  // Section-marker preservation: the arranger expects the same section
  // headers Bernie emitted. Don't allow the Professor to silently restructure.
  const draftSections = countSectionMarkers(input.draftLyrics)
  const finishedSections = countSectionMarkers(finished)
  if (draftSections > 0 && finishedSections !== draftSections) {
    return {
      lyrics: input.draftLyrics,
      personaVersion: persona.version,
      changeLog: [],
      fellBack: true,
      fallbackReason: 'section_markers_lost',
    }
  }

  const changeLog = Array.isArray(toolInput.changeLog)
    ? toolInput.changeLog.filter((t) => typeof t === 'string' && t.trim().length > 0).slice(0, 8)
    : []

  return {
    lyrics: finished,
    personaVersion: persona.version,
    changeLog,
    fellBack: false,
  }
}
