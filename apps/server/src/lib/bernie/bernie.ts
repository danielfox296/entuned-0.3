// Real Bernie (Card 13) — two-pass lyric generator.
//   Pass 1 (draft): writes a first draft around the hook using LyricDraftPrompt as system.
//   Pass 2 (edit):  rewrites the draft for brand voice + playability using LyricEditPrompt.
// Both prompts are DB-backed; `getOrSeed*` cold-starts v1 from the seed text in
// proto-bernie/lyrics.ts so the migration window is invisible. The Submission row
// captures both prompt versions for full provenance.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'
import { DRAFT_PROMPT_SEED, EDIT_PROMPT_SEED } from '../proto-bernie/lyrics.js'
import type { ArrangementSections } from '../arranger/arranger.js'

const MODEL = process.env.LYRICIST_MODEL ?? 'claude-sonnet-4-5'

export interface BernieInput {
  hookText: string
  brandLyricGuidelines?: string | null
  arrangementSections?: ArrangementSections | null
}

const SECTION_ORDER = ['intro', 'verse', 'pre_chorus', 'chorus', 'bridge', 'outro'] as const

// Serializes the decomposer's per-section instrumentation map into a brief prose
// brief for Bernie. Bernie uses this to match lyric density, phrasing, and energy
// to the arrangement shape — denser sections want more word weight, minimal
// sections want breathing room. Bernie should NOT name instruments in the lyrics
// themselves (that's the Arranger's job via [Instrument: ...] tags).
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

export interface BernieOutput {
  title: string
  lyrics: string
  draft: { title: string; lyrics: string }
  draftPromptVersion: number
  editPromptVersion: number
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

export async function generateLyrics(input: BernieInput): Promise<BernieOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const [draftPrompt, editPrompt] = await Promise.all([
    getOrSeedDraftPrompt(),
    getOrSeedEditPrompt(),
  ])

  const arrangementBrief = input.arrangementSections ? formatArrangementBrief(input.arrangementSections) : ''

  // Pass 1 — draft
  const draftUserMessage = `Hook (becomes the chorus, used verbatim):
"${input.hookText}"

${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}Write the lyrics now. Output the JSON only.`

  const draftResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: draftPrompt.promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: draftUserMessage }],
  })
  const draftBlock = draftResponse.content.find((b: any) => b.type === 'text') as any
  if (!draftBlock?.text) throw new Error('Bernie draft pass returned no text')
  const draft = parseLyricJson(draftBlock.text)

  // Pass 2 — edit
  const editUserMessage = `Hook (must remain verbatim in every chorus instance):
"${input.hookText}"

${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n\n` : ''}${arrangementBrief ? `${arrangementBrief}\n` : ''}Draft to polish:

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
