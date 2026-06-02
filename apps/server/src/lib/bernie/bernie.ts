// Bernie — single-pass lyric drafter.
//   Writes lyrics around the hook using LyricDraftPrompt as system, with
//   genre context + genre-family craft overrides when a GenreBrief is supplied.
//
// Retired 2026-05-25: the former two-pass shape (draft + LyricEditPrompt
// polish) collapsed into a single DRAFT-only pass when the Professor module
// took over post-draft craft finishing. EDIT v10's non-craft concerns
// (performance typography, parens discipline, tempo-aware shape, product
// imagery rule, anti-wisdom pre-choruses) were folded into DRAFT v19; craft
// finishing now lives in lib/professor. The `lyric_edit_prompts` table is
// retained for historical SongSeed provenance but no longer read at runtime.

import type Anthropic from '@anthropic-ai/sdk'
import type { ArrangementSections } from '../arranger/arranger.js'
import type { FormArchetypeChoice } from '../eno/form-archetype.js'
import { getAnthropic, resolveModel, extractToolUse } from '../_llm/client.js'
import { formatArrangementBrief, getOrSeedDraftPrompt } from './_helpers.js'
import { formatHardBanBlock } from './lyric-craft-rules.js'
import { getGenreCraftOverrides, formatGenreCraftBlock } from './genre-craft-rules.js'

const MODEL = resolveModel(process.env.LYRICIST_MODEL, 'claude-sonnet-4-6')

const EMIT_LYRICS_TOOL: Anthropic.Tool = {
  name: 'emit_lyrics',
  description: 'Emit the song title and full lyrics with Suno [Section] markers. The hook must appear verbatim wherever the form note instructs.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for the song.' },
      lyrics: { type: 'string', description: 'Full lyrics with [Section] markers (e.g., [Verse 1], [Chorus], [Bridge], [Final Chorus]).' },
    },
    required: ['title', 'lyrics'],
  },
}

export interface GenreBrief {
  genreTag: string
  grooveCharacter: string
  harmonicCharacter: string
  vocalRegister: string
  eraDecade: string
}

// Outcome-side emotional brief. Genre handles *craft* (rhyme, density,
// typography); outcome handles *affect* (mood, energy implied by tempo,
// tonal color from mode). Both flow into the draft pass; the editor stays
// outcome-blind so it doesn't try to re-architect emotional tenor.
export interface OutcomeBrief {
  mood: string
  tempoBpm: number
  mode: string
}

export interface BernieInput {
  hookText: string
  brandLyricGuidelines?: string | null
  arrangementSections?: ArrangementSections | null
  // Form archetype chosen by Eno (V/C/V/C/Bridge/FC, AABA, VCVC, etc.). Bernie
  // writes lyrics into whatever shape this declares. Optional for backward
  // compat with old call sites; when omitted, the draft prompt's legacy
  // hardcoded shape applies.
  formArchetype?: FormArchetypeChoice | null
  // Genre brief from the reference track. When supplied, the draft pass gets a
  // genre context block plus genre-family craft overrides (rhyme, density,
  // typography). Omitted = pop-default craft guidance from the seed prompt.
  genreBrief?: GenreBrief | null
  // Outcome brief — mood/tempo/mode for the requested Outcome. Tempo and mode
  // should be the *resolved* values (post-variance), matching what Suno
  // actually renders. Drives emotional tenor within the genre's craft world.
  outcomeBrief?: OutcomeBrief | null
}

export interface BernieOutput {
  title: string
  lyrics: string
  draftPromptVersion: number
}

// Render the chosen form's sections into a per-section brief. Each section
// names its [Section] marker and its arc — the stanza's job + how much space to
// leave. This is what gives each stanza intention instead of texture.
export function formatFormBrief(form: FormArchetypeChoice): string {
  const lines = form.sections.map((s) => {
    const marker = s.optional ? `[${s.label}] (optional — include only if it earns its place)` : `[${s.label}]`
    return `- ${marker} — ${s.arc}`
  })
  return `Song form — write every section below, in order, each under its [Section] marker. Do NOT add or remove sections. Each section has a job (its "arc"): follow it. The arc says what the stanza does and how much room to leave — honor the restraint. A short, unfinished line is a finished line; don't complete a thought just because you can.
Form note: ${form.shapeNote}
Sections:
${lines.join('\n')}
`
}

function formatGenreContext(brief: GenreBrief): string {
  const parts: string[] = []
  parts.push(`Genre: ${brief.genreTag}`)
  if (brief.eraDecade) parts.push(`Era: ${brief.eraDecade}`)
  if (brief.grooveCharacter) parts.push(`Groove: ${brief.grooveCharacter}`)
  if (brief.harmonicCharacter) parts.push(`Harmonic character: ${brief.harmonicCharacter}`)
  if (brief.vocalRegister) parts.push(`Vocal register: ${brief.vocalRegister}`)
  return `Reference track context (write lyrics that fit this musical world — do NOT name these terms in the lyrics):
${parts.join('\n')}
`
}

function formatOutcomeBrief(brief: OutcomeBrief): string {
  return `Emotional brief (the outcome — write lyrics whose tone, pacing, and word density match this. The genre context above informs *craft* — rhyme, line structure, vocabulary register; the brief here informs *affect*. When the two would pull opposite directions, deliver the genre's craft in the outcome's affective register):
Mood: ${brief.mood}
Tempo: ${brief.tempoBpm}bpm
Mode: ${brief.mode}
`
}

export async function generateLyrics(input: BernieInput): Promise<BernieOutput> {
  const client = getAnthropic()

  const [draftPrompt, hardBanBlock] = await Promise.all([
    getOrSeedDraftPrompt(),
    formatHardBanBlock(),
  ])

  const arrangementBrief = input.arrangementSections ? formatArrangementBrief(input.arrangementSections) : ''
  const formBrief = input.formArchetype ? formatFormBrief(input.formArchetype) : ''

  const genreContext = input.genreBrief ? formatGenreContext(input.genreBrief) : ''
  const genreOverrides = input.genreBrief ? await getGenreCraftOverrides(input.genreBrief.genreTag) : null
  const genreCraftBlock = genreOverrides ? `\n${formatGenreCraftBlock(genreOverrides)}\n` : ''
  const outcomeBrief = input.outcomeBrief ? formatOutcomeBrief(input.outcomeBrief) : ''

  // Pass 1 — draft. Genre context + craft block steer the draft toward the
  // reference track's genre family (hip-hop bars vs country storytelling vs
  // EDM chant); the outcome brief sets emotional tenor (mood, tempo, mode).
  // Genre = craft; outcome = affect. Pop / outcome-blind defaults apply when
  // the respective brief is absent.
  const draftUserMessage = `Hook (used verbatim wherever the form note instructs — usually every chorus, but for AABA-style forms the hook lands as the last line of every verse):
"${input.hookText}"

${formBrief ? `${formBrief}\n` : ''}${genreContext ? `${genreContext}\n` : ''}${outcomeBrief ? `${outcomeBrief}\n` : ''}${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}${genreCraftBlock}${hardBanBlock ? `${hardBanBlock}\n\n` : ''}Write the lyrics now. Output the JSON only.`

  const draftResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: draftPrompt.promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: draftUserMessage }],
    tools: [EMIT_LYRICS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_lyrics' },
  })
  const draftToolUse = extractToolUse(draftResponse, 'emit_lyrics')
  if (!draftToolUse) throw new Error('Bernie draft pass did not emit tool_use')
  const draft = draftToolUse as { title: string; lyrics: string }
  if (!draft.title || !draft.lyrics) throw new Error('Bernie draft output missing title or lyrics')

  return {
    title: draft.title,
    lyrics: draft.lyrics,
    draftPromptVersion: draftPrompt.version,
  }
}
