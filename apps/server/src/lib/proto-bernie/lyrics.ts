// Proto-Bernie: a single-pass lyric generator. Real Bernie (Card 13) is two-pass
// (draft → edit) and will replace this. The prompts are now DB-backed via the
// LyricDraftPrompt / LyricEditPrompt tables, with code seeds as fallback for
// dev/cold-start.

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'

const MODEL = process.env.LYRICIST_MODEL ?? 'claude-sonnet-4-5'

export interface LyricInput {
  hookText: string
  brandLyricGuidelines?: string | null
}

export interface LyricOutput {
  title: string
  lyrics: string
}

export const DRAFT_PROMPT_SEED = `
You write lyrics for a brand's in-store music. The hook is given to you — the rest is
yours to write around. Match the hook's voice, mood, and rhythm. Keep verses short and
human; not every line needs to rhyme.

Constraints:
- Use Suno [Section] markers: [Intro], [Verse 1], [Chorus], [Verse 2], [Bridge], [Outro].
- The hook becomes the chorus. Don't paraphrase it; quote it verbatim each time.
- Write 2 verses + chorus + bridge + final chorus. Modest length — Suno trims long sections.
- Less density than AI typically gives. Conversational, not preachy. Real images.
- Output JSON: { "title": string, "lyrics": string }. No prose around it.

Brand voice (when guidelines are present):
- Warm, confident, never preachy.
- Avoid jargon.
- Lyrics should sound like something a person would say, not a slogan.

NEVER write the phrase "good with that, just the way you are" or any close paraphrase.
That is permanently banned by editorial decision.
`.trim()

export const EDIT_PROMPT_SEED = `
You receive draft lyrics around an approved hook plus the brand's lyric guidelines.
Your job: polish for brand voice and musical playability while preserving the hook
verbatim.

Edit toward:
- Stronger imagery, fewer abstractions
- Conversational diction; no slogans, no jargon
- Shorter lines where lines feel cluttered
- Each verse landing on a phrase that sets up the chorus

Do NOT:
- Change the hook's wording
- Add or remove sections
- Rewrite into a different metrical scheme
- Restate brand values explicitly (the lyrics should embody them, not mention them)

Output JSON: { "title": string, "lyrics": string }. No prose around it.
`.trim()

async function getDraftPrompt(): Promise<string> {
  const row = await prisma.lyricDraftPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return row.promptText
  // Cold-start: seed v1 from code.
  const seeded = await prisma.lyricDraftPrompt.create({
    data: { version: 1, promptText: DRAFT_PROMPT_SEED, notes: 'Auto-seeded v1' },
  })
  return seeded.promptText
}

export async function generateLyrics(input: LyricInput): Promise<LyricOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const systemPrompt = await getDraftPrompt()

  const userMessage = `Hook (becomes the chorus, used verbatim):
"${input.hookText}"

${input.brandLyricGuidelines ? `Brand lyric guidelines:\n${input.brandLyricGuidelines}\n` : ''}
Write the lyrics now. Output the JSON only.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = response.content.find((b: any) => b.type === 'text') as any
  if (!text?.text) throw new Error('Lyricist returned no text')

  const cleaned = text.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('No JSON in lyricist output')
  const parsed = JSON.parse(cleaned.slice(start)) as LyricOutput
  if (!parsed.title || !parsed.lyrics) throw new Error('Lyricist output missing title or lyrics')
  return parsed
}
