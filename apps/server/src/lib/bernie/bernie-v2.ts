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

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'
import { DRAFT_PROMPT_SEED, EDIT_PROMPT_SEED } from '../proto-bernie/lyrics.js'
import type { ArrangementSections } from '../arranger/arranger.js'
import type { FormArchetypeChoice } from '../eno/form-archetype.js'
import { getGenreCraftOverrides, formatGenreCraftBlock } from './genre-craft-rules.js'
import type { BernieOutput } from './bernie.js'

const MODEL = process.env.LYRICIST_MODEL ?? 'claude-sonnet-4-5'

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

const SECTION_ORDER = ['intro', 'verse', 'pre_chorus', 'chorus', 'bridge', 'outro'] as const

function formatArrangementBrief(sections: ArrangementSections): string {
  const lines: string[] = []
  for (const key of SECTION_ORDER) {
    const directive = sections[key]
    if (!directive || directive.instruments.length === 0) continue
    const density = directive.density ?? 'medium'
    const instruments = directive.instruments.slice(0, 3).join(', ')
    const label = key === 'pre_chorus' ? 'pre-chorus' : key
    const extras: string[] = []
    if (directive.dynamic) extras.push(directive.dynamic)
    if (directive.vocal_delivery) extras.push(directive.vocal_delivery)
    const extrasStr = extras.length > 0 ? ` (${extras.join(', ')})` : ''
    lines.push(`- ${label}: ${density}${extrasStr} — ${instruments}`)
  }
  if (lines.length === 0) return ''
  return `Arrangement (per section — match lyric density and energy to this; do NOT name instruments in the lyric lines):
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

async function getOrSeedDraftPrompt(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.lyricDraftPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.lyricDraftPrompt.create({
    data: { version: 1, promptText: DRAFT_PROMPT_SEED, notes: 'Auto-seeded v1' },
  })
  return { version: seeded.version, promptText: seeded.promptText }
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

function parseLyricJson(text: string): { title: string; lyrics: string } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('No JSON in lyricist output')
  const parsed = JSON.parse(cleaned.slice(start)) as { title?: string; lyrics?: string }
  if (!parsed.title || !parsed.lyrics) throw new Error('Lyricist output missing title or lyrics')
  return { title: parsed.title, lyrics: parsed.lyrics }
}

export async function generateLyricsV2(input: BernieV2Input): Promise<BernieOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const [draftPrompt, editPrompt] = await Promise.all([
    getOrSeedDraftPrompt(),
    getOrSeedEditPrompt(),
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

${formBrief ? `${formBrief}\n` : ''}${genreContext ? `${genreContext}\n` : ''}${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}${genreCraftBlock}Write the lyrics now. Output the JSON only.`

  const draftResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: draftPrompt.promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: draftUserMessage }],
  })
  const draftBlock = draftResponse.content.find((b: any) => b.type === 'text') as any
  if (!draftBlock?.text) throw new Error('Bernie-v2 draft pass returned no text')
  const draft = parseLyricJson(draftBlock.text)

  // Pass 2 — edit (same as Eno-1 — genre awareness lives in the draft)
  const editUserMessage = `Hook (must remain verbatim in every instance the draft used it — choruses, verse-end refrains, tag, whatever the form dictates):
"${input.hookText}"

${formBrief ? `${formBrief}\n` : ''}${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}Draft to polish:

Title: ${draft.title}

${draft.lyrics}

Polish the lyrics per the editor instructions. Preserve the hook verbatim. Output the JSON only.`

  const editResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: editPrompt.promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: editUserMessage }],
  })
  const editBlock = editResponse.content.find((b: any) => b.type === 'text') as any
  if (!editBlock?.text) throw new Error('Bernie-v2 edit pass returned no text')
  const final = parseLyricJson(editBlock.text)

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
