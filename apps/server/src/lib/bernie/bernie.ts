// Real Bernie (Card 13) — two-pass lyric generator.
//   Pass 1 (draft): writes a first draft around the hook using LyricDraftPrompt as system.
//   Pass 2 (edit):  rewrites the draft for brand voice + playability using LyricEditPrompt.
// Both prompts are DB-backed; `getOrSeed*` cold-starts v1 from the seed text in
// proto-bernie/lyrics.ts so the migration window is invisible. The Submission row
// captures both prompt versions for full provenance.
//
// EXPERIMENT SURFACE — Bernie-1 / Bernie-2 pair.
//   This file (bernie.ts) is the Bernie-1 lyric generator, called from the
//   Eno-1 pipeline (../eno/eno.ts). Its sibling bernie-v2.ts is the genre-aware
//   Bernie-2 variant called from the Eno-2 pipeline (../eno/eno-v2.ts).
//   Bernie-1 is the production default — Eno-1 is default, see ../eno/README.md.
//   The two files share helper code via ./_helpers.ts. See ../eno/README.md
//   for the diff inventory and the rule that this pair is an opt-in
//   experiment surface whose shape may change.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'
import { EDIT_PROMPT_SEED } from '../proto-bernie/lyrics.js'
import type { ArrangementSections } from '../arranger/arranger.js'
import type { FormArchetypeChoice } from '../eno/form-archetype.js'
import { formatArrangementBrief, getOrSeedDraftPrompt, parseLyricJson } from './_helpers.js'

const MODEL = process.env.LYRICIST_MODEL ?? 'claude-sonnet-4-6'

export interface BernieInput {
  hookText: string
  brandLyricGuidelines?: string | null
  arrangementSections?: ArrangementSections | null
  // Form archetype chosen by Eno (V/C/V/C/Bridge/FC, AABA, VCVC, etc.). Bernie
  // writes lyrics into whatever shape this declares. Optional for backward
  // compat with old call sites; when omitted, the draft prompt's legacy
  // hardcoded shape applies.
  formArchetype?: FormArchetypeChoice | null
}

export interface BernieOutput {
  title: string
  lyrics: string
  draft: { title: string; lyrics: string }
  draftPromptVersion: number
  editPromptVersion: number
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

  // Pass 1 — draft
  const draftUserMessage = `Hook (used verbatim wherever the form note instructs — usually every chorus, but for AABA-style forms the hook lands as the last line of every verse):
"${input.hookText}"

${formBrief ? `${formBrief}\n` : ''}${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}Write the lyrics now. Output the JSON only.`

  const draftResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: draftPrompt.promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: draftUserMessage }],
  })
  const draftBlock = draftResponse.content.find((b: any) => b.type === 'text') as any
  if (!draftBlock?.text) throw new Error('Bernie draft pass returned no text')
  const draft = parseLyricJson(draftBlock.text)

  // Pass 2 — edit.
  // Form and arrangement context are intentionally OMITTED from the edit
  // user-message: the draft already encoded section structure into the lyrics,
  // and the editor's job is polish, not re-architecture. Re-injecting form/
  // arrangement here just pays tokens for context the editor doesn't act on.
  const editUserMessage = `Hook (must remain verbatim in every instance the draft used it — choruses, verse-end refrains, tag, whatever the form dictates):
"${input.hookText}"

${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}Draft to polish:

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
  if (!editBlock?.text) throw new Error('Bernie edit pass returned no text')
  const final = parseLyricJson(editBlock.text)

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
