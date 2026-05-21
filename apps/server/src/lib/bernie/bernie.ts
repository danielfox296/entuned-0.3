// Bernie — two-pass lyric generator.
//   Pass 1 (draft): writes a first draft around the hook using LyricDraftPrompt as system,
//     with genre context + genre-family craft overrides when a GenreBrief is supplied.
//   Pass 2 (edit):  rewrites the draft for brand voice + playability using LyricEditPrompt.
// Both prompts are DB-backed; `getOrSeed*` cold-starts v1 from the seed text in
// proto-bernie/lyrics.ts so the migration window is invisible. The Submission row
// captures both prompt versions for full provenance.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'
import { EDIT_PROMPT_SEED } from '../proto-bernie/lyrics.js'
import type { ArrangementSections } from '../arranger/arranger.js'
import type { FormArchetypeChoice } from '../eno/form-archetype.js'
import { formatArrangementBrief, getOrSeedDraftPrompt } from './_helpers.js'
import { formatHardBanBlock } from './lyric-craft-rules.js'
import { getGenreCraftOverrides, formatGenreCraftBlock } from './genre-craft-rules.js'

const MODEL = process.env.LYRICIST_MODEL ?? 'claude-sonnet-4-6'

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
  draft: { title: string; lyrics: string }
  draftPromptVersion: number
  editPromptVersion: number
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

async function getOrSeedEditPrompt(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.lyricEditPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.lyricEditPrompt.create({
    data: { version: 1, promptText: EDIT_PROMPT_SEED, notes: 'Auto-seeded v1' },
  })
  return { version: seeded.version, promptText: seeded.promptText }
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

export async function generateLyrics(input: BernieInput): Promise<BernieOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const [draftPrompt, editPrompt, hardBanBlock] = await Promise.all([
    getOrSeedDraftPrompt(),
    getOrSeedEditPrompt(),
    formatHardBanBlock(),
  ])

  const arrangementBrief = input.arrangementSections ? formatArrangementBrief(input.arrangementSections) : ''
  const formBrief = input.formArchetype
    ? `Song form (use this exact section structure — do NOT add or remove sections):
Sections: ${input.formArchetype.sectionList}
Form note: ${input.formArchetype.shapeNote}
`
    : ''

  const genreContext = input.genreBrief ? formatGenreContext(input.genreBrief) : ''
  const genreOverrides = input.genreBrief ? getGenreCraftOverrides(input.genreBrief.genreTag) : null
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
  const draftToolUse = draftResponse.content.find((b: any) => b.type === 'tool_use' && (b as any).name === 'emit_lyrics') as any
  if (!draftToolUse) throw new Error('Bernie draft pass did not emit tool_use')
  const draft = draftToolUse.input as { title: string; lyrics: string }
  if (!draft.title || !draft.lyrics) throw new Error('Bernie draft output missing title or lyrics')

  // Pass 2 — edit.
  // Form, arrangement, genre context, and outcome brief are intentionally
  // OMITTED from the edit user-message: the draft already encoded section
  // structure, genre craft, and emotional tenor into the lyrics, and the
  // editor's job is polish, not re-architecture. Re-injecting that context
  // here just pays tokens for input the editor doesn't act on.
  const editUserMessage = `Hook (must remain verbatim in every instance the draft used it — choruses, verse-end refrains, tag, whatever the form dictates):
"${input.hookText}"

${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${hardBanBlock ? `${hardBanBlock}\n\n` : ''}Draft to polish:

Title: ${draft.title}

${draft.lyrics}

Polish the lyrics per the editor instructions. Preserve the hook verbatim. Output the JSON only.`

  const editResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: editPrompt.promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: editUserMessage }],
    tools: [EMIT_LYRICS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_lyrics' },
  })
  const editToolUse = editResponse.content.find((b: any) => b.type === 'tool_use' && (b as any).name === 'emit_lyrics') as any
  if (!editToolUse) throw new Error('Bernie edit pass did not emit tool_use')
  const final = editToolUse.input as { title: string; lyrics: string }
  if (!final.title || !final.lyrics) throw new Error('Bernie edit output missing title or lyrics')

  // Hook preservation invariant: the polished output must contain the hook verbatim
  // in every chorus instance the draft had. Counting handles [Chorus] + [Final Chorus]:
  // the editor is allowed to vary non-hook lines in [Final Chorus], but must not drop
  // or paraphrase the hook line itself.
  const draftHookCount = countOccurrences(draft.lyrics, input.hookText)
  const finalHookCount = countOccurrences(final.lyrics, input.hookText)
  if (finalHookCount < Math.max(1, draftHookCount)) {
    // Fall back to the draft if the editor lost any hook instance. The alternative is
    // shipping lyrics with a missing or paraphrased chorus hook, which violates the
    // chorus contract.
    return {
      title: draft.title,
      lyrics: draft.lyrics,
      draft,
      draftPromptVersion: draftPrompt.version,
      editPromptVersion: editPrompt.version,
    }
  }

  return {
    title: final.title,
    lyrics: final.lyrics,
    draft,
    draftPromptVersion: draftPrompt.version,
    editPromptVersion: editPrompt.version,
  }
}
