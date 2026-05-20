// Bernie-v2 — genre-aware two-pass lyric generator (Eno-2 pipeline).
//
// Same two-pass (draft → edit) architecture as bernie.ts. Same DB-backed prompts,
// same BernieOutput shape, same hook-preservation invariant. The difference:
//
//   1. Accepts a GenreBrief describing the reference track's genre, groove, and
//      harmonic character.
//   2. Looks up genre-conditioned craft rules and injects them into the user
//      message (not the system prompt — preserves prompt caching).
//   3. Adds a genre context block so the draft pass knows what kind of song it's
//      writing (hip-hop bars vs. country storytelling vs. EDM chant).
//
// The edit pass is identical to Eno-1 — genre awareness lives in the draft.
//
// EXPERIMENT SURFACE — opt-in Bernie-2 lane.
//   Only consumer is ../eno/eno-v2.ts (Eno-2). Eno-2 itself is opt-in via the
//   Dash pipeline toggle, which defaults to Eno-1; in default production
//   traffic this file is not on the call path. Reuses BernieOutput from
//   bernie.ts and the same DRAFT_PROMPT_SEED / EDIT_PROMPT_SEED constants
//   from proto-bernie. See ../eno/README.md for the full pair contract and
//   the note that this file's shape may change while Eno-2 is being tested.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'
import { EDIT_PROMPT_SEED } from '../proto-bernie/lyrics.js'
import type { ArrangementSections } from '../arranger/arranger.js'
import type { FormArchetypeChoice } from '../eno/form-archetype.js'
import { getGenreCraftOverrides, formatGenreCraftBlock } from './genre-craft-rules.js'
import type { BernieOutput } from './bernie.js'
import { formatArrangementBrief, getOrSeedDraftPrompt } from './_helpers.js'
import { formatHardBanBlock } from './lyric-craft-rules.js'

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

export interface BernieV2Input {
  hookText: string
  brandLyricGuidelines?: string | null
  arrangementSections?: ArrangementSections | null
  formArchetype?: FormArchetypeChoice | null
  genreBrief?: GenreBrief | null
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

export async function generateLyricsV2(input: BernieV2Input): Promise<BernieOutput> {
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

  // Genre context + craft overrides — the Eno-2 addition
  const genreContext = input.genreBrief ? formatGenreContext(input.genreBrief) : ''
  const genreOverrides = input.genreBrief
    ? getGenreCraftOverrides(input.genreBrief.genreTag)
    : null
  const genreCraftBlock = genreOverrides ? `\n${formatGenreCraftBlock(genreOverrides)}\n` : ''

  // Pass 1 — draft (genre-aware)
  const draftUserMessage = `Hook (used verbatim wherever the form note instructs — usually every chorus, but for AABA-style forms the hook lands as the last line of every verse):
"${input.hookText}"

${formBrief ? `${formBrief}\n` : ''}${genreContext ? `${genreContext}\n` : ''}${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}${genreCraftBlock}${hardBanBlock ? `${hardBanBlock}\n\n` : ''}Write the lyrics now. Output the JSON only.`

  const draftResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: draftPrompt.promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: draftUserMessage }],
    tools: [EMIT_LYRICS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_lyrics' },
  })
  const draftToolUse = draftResponse.content.find((b: any) => b.type === 'tool_use' && (b as any).name === 'emit_lyrics') as any
  if (!draftToolUse) throw new Error('Bernie-v2 draft pass did not emit tool_use')
  const draft = draftToolUse.input as { title: string; lyrics: string }
  if (!draft.title || !draft.lyrics) throw new Error('Bernie-v2 draft output missing title or lyrics')

  // Pass 2 — edit (same as Eno-1 — genre awareness lives in the draft)
  const editUserMessage = `Hook (must remain verbatim in every instance the draft used it — choruses, verse-end refrains, tag, whatever the form dictates):
"${input.hookText}"

${formBrief ? `${formBrief}\n` : ''}${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}${hardBanBlock ? `${hardBanBlock}\n\n` : ''}Draft to polish:

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
  if (!editToolUse) throw new Error('Bernie-v2 edit pass did not emit tool_use')
  const final = editToolUse.input as { title: string; lyrics: string }
  if (!final.title || !final.lyrics) throw new Error('Bernie-v2 edit output missing title or lyrics')

  // Hook preservation invariant — identical to Eno-1
  const draftHookCount = countOccurrences(draft.lyrics, input.hookText)
  const finalHookCount = countOccurrences(final.lyrics, input.hookText)
  if (finalHookCount < Math.max(1, draftHookCount)) {
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
