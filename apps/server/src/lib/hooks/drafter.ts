// Hook Drafter — generates N candidate hooks for (ICP, Outcome) using Claude.
// The system prompt comes from HookDrafterPrompt.promptText (per-ICP, editable).
// The user message bundles ICP psychographic profile + outcome physiology + brand
// guidelines + the existing approved-hook list (so the model can vary).

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'
import { OVERUSED_WORDS } from '../bernie/lyric-craft-rules.js'

const MODEL = process.env.HOOK_DRAFTER_MODEL ?? 'claude-sonnet-4-5'

export const HOOK_WRITER_PROMPT_SEED = `
You write hook lines for a brand's in-store music. A hook becomes the chorus —
sung verbatim every time it appears. Verses and bridge are written around it
later by a separate lyricist. Your job is to write the line the whole song
hangs on.

## What separates a great hook from a mediocre one

A hook is 4–10 words. But word count is the easy part. The hard part:

**Concrete over abstract.** A great hook puts a picture, a sensation, or a
specific moment in the listener's mouth. "Warm leather and a Sunday drive" is
concrete. "Find your inner peace" is a poster. If you can't point at the thing
the hook describes, it's too abstract.

**Mouth-feel matters.** The hook will be sung dozens of times across a playlist.
It needs to feel good in the mouth — open vowels for sustained notes, consonant
clusters for rhythmic punch, stressed syllables that land on downbeats. Read it
aloud. If it feels like chewing cardboard, rewrite.

**Payoff, not setup.** The hook is where the song arrives. It resolves the
tension the verses build. A hook that sounds like the beginning of a thought
("Maybe someday we'll…") fails — it should sound like the END of a thought.

**Person, not brand.** It should sound like something a real person would say in
a real moment — not a slogan, not a motivational poster, not an ad headline.
The brand's values should be felt, not named.

## The gap between weak and strong

Weak hooks share patterns: they're vague, interchangeable, and sound like AI
wrote them. Strong hooks are specific, surprising, and sticky.

WEAK → STRONG examples (for calibration, not for copying):
- "Rise above it all" → "Dust on my boots and nowhere to be"
- "Find what you're looking for" → "Didn't know I needed this"
- "Feel the energy" → "Three sips in and the whole room shifts"
- "Live in the moment" → "Clock says late but my feet say stay"
- "Be who you are" → "Still wearing yesterday's good idea"
- "Chase your dreams" → "Left the keys on the counter on purpose"

Notice: the strong versions are SCENES. A person, a place, a small action.
They imply the feeling without naming it.

## Diction rules

Let the outcome's musical specs shape your word choices:
- **Slow tempo (< 90 bpm):** longer vowels, fewer syllables per line, spacious
  phrasing. The singer needs room to breathe.
- **Fast tempo (> 110 bpm):** tighter consonants, more syllables, rhythmic
  snap. Words should want to tumble forward.
- **Minor mode:** tension words, unresolved images, bittersweet. Not sad — taut.
- **Major mode:** open, resolved, daylight. Not happy — settled.

Avoid these overused AI-lyric words (and their variants): ${OVERUSED_WORDS.slice(0, 30).join(', ')}, and similar. If the word sounds like it belongs in a fantasy novel or a self-help book, cut it.

NEVER write the phrase "good with that, just the way you are" or any close
paraphrase. That phrase is permanently banned by editorial decision.

## Structural variance

Each batch must use DIFFERENT structural approaches. Spread across these levers:

1. **Sentence type:** declaration ("This is the part I keep"), question
   ("Who taught you to walk like that?"), imperative ("Leave the light on"),
   observation ("Funny how the good ones stay quiet"), fragment
   ("Dust and honey and a long way home").
2. **Tense:** present ("I'm taking the long way"), past ("Never did figure
   that one out"), future ("Gonna need a bigger table").
3. **Point of view:** self ("I already know"), other ("You wear it like it's
   nothing"), collective ("We don't do that here"), impersonal ("Something about
   this place").
4. **Specificity dial:** tight scene ("Coffee rings on the lease agreement"),
   medium ("Feels like the first warm night"), wide ("Some things just fit").

Do not cluster. If you've written three declarations in a row, the next one
must be a question, observation, or fragment. If three hooks are present-tense,
switch.

## Vocal-gender tagging (per-hook)

Tag each hook with a vocal_gender for downstream reference-track pairing:

- "male" — uses he/him/his or has an unambiguously male first-person POV.
- "female" — uses she/her/hers or has an unambiguously female first-person POV.
- "duet" — structured as call-and-response between two voices.
- null — gender-neutral, singable by any voice. **This is the default for the
  vast majority of hooks.** Only tag male/female/duet when the lyric requires it.

## Output

JSON only, no prose, no markdown fences:

{ "hooks": [ { "text": "...", "vocal_gender": null }, ... ] }

Do not number the hooks. Do not repeat any hook from the existing-hooks list.
`.trim()

export async function getOrSeedHookWriterPrompt(icpId: string): Promise<{ id: string; icpId: string; promptText: string }> {
  const existing = await prisma.hookWriterPrompt.findUnique({ where: { icpId } })
  if (existing) return existing
  return prisma.hookWriterPrompt.create({
    data: { icpId, promptText: HOOK_WRITER_PROMPT_SEED },
  })
}

export type HookVocalGender = 'male' | 'female' | 'duet' | null

export interface DraftedHook {
  text: string
  vocalGender: HookVocalGender
}

export interface DraftHooksResult {
  hooks: DraftedHook[]
  rawText: string
  promptUsed: string
}

/**
 * Builds the system + user message that the hook drafter sends to Claude.
 * Pulled out so the admin can preview the exact context without firing an
 * LLM call.
 */
export async function buildHookDrafterContext(opts: {
  icpId: string
  outcomeId: string
  n: number
}): Promise<{ systemPrompt: string; userMessage: string }> {
  const [icp, outcome, prompt] = await Promise.all([
    prisma.iCP.findUniqueOrThrow({ where: { id: opts.icpId }, include: { client: true } }),
    prisma.outcome.findUniqueOrThrow({
      where: { id: opts.outcomeId },
      include: { productionEra: true },
    }),
    getOrSeedHookWriterPrompt(opts.icpId),
  ])

  // Per-outcome operator guidance (keyed by outcomeKey so it survives across
  // outcome versions). Optional — if not present or empty, the section is omitted.
  const lyricFactor = await prisma.outcomeLyricFactor.findUnique({
    where: { outcomeKey: outcome.outcomeKey },
    select: { templateText: true },
  })
  const lyricGuidance = lyricFactor?.templateText?.trim() || null

  const existingHooks = await prisma.hook.findMany({
    where: { icpId: opts.icpId, outcomeId: opts.outcomeId },
    select: { text: true, status: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  const icpDescriptor = [
    icp.name && `Name: ${icp.name}`,
    icp.ageRange && `Age range: ${icp.ageRange}`,
    icp.location && `Location: ${icp.location}`,
    icp.politicalSpectrum && `Political: ${icp.politicalSpectrum}`,
    icp.openness && `Openness: ${icp.openness}`,
    icp.fears && `Fears: ${icp.fears}`,
    icp.values && `Values: ${icp.values}`,
    icp.desires && `Desires: ${icp.desires}`,
    icp.unexpressedDesires && `Unexpressed desires: ${icp.unexpressedDesires}`,
    icp.turnOffs && `Turn-offs: ${icp.turnOffs}`,
  ].filter(Boolean).join('\n')

  // The emotional target the brand chose for this outcome. `displayTitle` is
  // the human/brand-facing label (e.g. "Calm"); `title` is an internal seed
  // string (e.g. "arrows down") that on its own gives the LLM no signal.
  const emotionalTarget = outcome.displayTitle ?? outcome.title
  const era = outcome.productionEra
  const outcomeDescriptor = [
    `Emotional target: ${emotionalTarget}`,
    outcome.displayTitle && outcome.displayTitle !== outcome.title
      ? `Internal name: ${outcome.title}`
      : null,
    `Tempo: ${outcome.tempoBpm} bpm`,
    `Mode: ${outcome.mode}`,
    outcome.dynamics && `Dynamics: ${outcome.dynamics}`,
    outcome.instrumentation && `Instrumentation: ${outcome.instrumentation}`,
    outcome.familiarity && `Familiarity: ${outcome.familiarity}`,
    era && `Production era: ${era.genreDisplayName ?? era.genreSlug} · ${era.decade}`,
    era?.textureLanguage && `Era texture: ${era.textureLanguage}`,
  ].filter(Boolean).join('\n')

  const userMessage = `# ICP

${icpDescriptor}

# Outcome (the song's emotional target)

The hooks you write must embody and pay off the **emotional target** below.
Treat the emotional target as the controlling intent — every hook should land
inside that feeling. The musical specs (tempo / mode / instrumentation / era)
are constraints the song will be produced within; let them inform the
diction, density, and image vocabulary of the hook.

${outcomeDescriptor}

${lyricGuidance ? `# Lyric guidance for this outcome\n\nThis is operator-authored guidance specific to the **${emotionalTarget}** outcome. Treat it as authoritative on diction, imagery, and what to avoid for this emotional target.\n\n${lyricGuidance}\n\n` : ''}${icp.client?.brandLyricGuidelines ? `# Brand lyric guidelines\n\n${icp.client.brandLyricGuidelines}\n\n` : ''}# Existing hooks (do not repeat)

${existingHooks.length === 0 ? '(none)' : existingHooks.map((h) => `- "${h.text}" (${h.status})`).join('\n')}

# Task

Write ${opts.n} new hook candidates for this ICP + Outcome.

Requirements:
- Spread across at least 3 different sentence types (declaration, question, imperative, observation, fragment).
- Mix tenses and POVs — no more than half the batch in the same tense or the same POV.
- Every hook must pass the "scene test": can you picture a specific person in a specific moment? If not, it's too abstract.
- Let the tempo and mode shape your syllable density and vowel choices.

Output JSON only.`

  return { systemPrompt: prompt.promptText, userMessage }
}

export async function draftHooks(opts: {
  icpId: string
  outcomeId: string
  n: number
}): Promise<DraftHooksResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const { systemPrompt, userMessage } = await buildHookDrafterContext(opts)

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((b: any) => b.type === 'text') as any
  if (!textBlock?.text) throw new Error('Hook drafter returned no text')
  const raw = textBlock.text as string

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in drafter output')
  const parsed = JSON.parse(cleaned.slice(start)) as { hooks: unknown }
  if (!Array.isArray(parsed.hooks)) throw new Error('Drafter output missing hooks array')

  // Accept both shapes: legacy bare-string array and the v2 structured-object
  // array. The structured form is what the current prompt produces, but
  // tolerating bare strings keeps prompt edits forgiving.
  const allowed: HookVocalGender[] = ['male', 'female', 'duet', null]
  const hooks: DraftedHook[] = parsed.hooks
    .map((row): DraftedHook | null => {
      if (typeof row === 'string') {
        const t = row.trim()
        return t ? { text: t, vocalGender: null } : null
      }
      if (row && typeof row === 'object') {
        const r = row as { text?: unknown; vocal_gender?: unknown; vocalGender?: unknown }
        const text = typeof r.text === 'string' ? r.text.trim() : ''
        if (!text) return null
        const raw = r.vocal_gender ?? r.vocalGender
        const vocalGender =
          raw === 'male' || raw === 'female' || raw === 'duet' ? raw : null
        if (!allowed.includes(vocalGender)) return null
        return { text, vocalGender }
      }
      return null
    })
    .filter((h): h is DraftedHook => h !== null)

  return { hooks, rawText: raw, promptUsed: systemPrompt }
}
