// Hook Drafter — generates N candidate hooks for (ICP, Outcome) using Claude.
//
// Architecture (post-2026-05-24 refactor):
//   - ONE universal system prompt (craft rules, applies to every call).
//   - User message = outcome's emotional target + tempo/mode + brand lyric
//     guidelines (light, when present) + per-outcome behavioral overlay from
//     OutcomeLyricFactor.templateText.
//   - No ICP psychographics in the prompt (over-signal — caused centroid
//     collapse to ICP-shaped self-affirmation hooks).
//   - No approved-exemplars positive anchor (anchoring on past hooks creates
//     a positive centroid that the model copies into).
//   - No rejected-anti-anchor (operator workflow is edit-or-delete, not
//     reject-with-reason; rejection corpus is too thin to teach).
//   - No surface-level dedup (trigram dedup overweighted false-positives and
//     killed variance candidates; with a well-prompted model the collision
//     rate against an existing pool is naturally low — see "infinite monkeys"
//     reasoning).

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, resolveModel, extractToolUse } from '../_llm/client.js'
import { prisma } from '../../db.js'
import { formatHardBanBlock } from '../bernie/lyric-craft-rules.js'

const MODEL = resolveModel(process.env.HOOK_DRAFTER_MODEL, 'claude-sonnet-4-6')

// Cold-start seed only. Live prompt lives in `hook_drafter_prompts` (DB);
// editable from Dash → Prompts & Rules → Hook Drafter. On first run after
// migration, getOrSeedHookDrafterPrompt() inserts this as v1. After that the
// const is never consulted at runtime.
export const HOOK_SYSTEM_PROMPT_SEED = `
You write hook lines for a brand's in-store music. A hook becomes the chorus — sung verbatim every time it appears. The lyricist writes verses + bridge around it later. Your job is to write the line the whole song hangs on.

The user message will include the outcome's emotional target (tempo, mode, behavioral intent) and per-outcome lyric direction. Treat the per-outcome direction as authoritative on content and tone — this system prompt defines the craft rules that apply to every hook regardless of outcome.

## What a great hook is

A hook is 4–10 words (occasionally a short tag of 1–3). It does ONE of three things, well:

1. **Names a thing.** A specific person, place, object, time, image, or action. "She left her keys on the counter." "Hotel California." "Smoke on the water." The music carries the mood; the lyric names what the song is *about*.

2. **Describes a moment.** A small physical sensation, sensory observation, or quiet interior beat. "The third lap around the block." "The pause before pulling out the card." Not an emotion named — the *cause* of the emotion described.

3. **Speaks a direct behavior or intention.** For outcomes that prime a specific action ("stick around a while", "one for the road", "the better one this time"), the hook can voice the intention directly in plain speech. Appropriate only when the per-outcome direction asks for it.

A hook should sound like something a real person would say in a real moment — never a slogan, never a motivational poster, never ad copy.

## What a weak hook is

Weak hooks are ABSTRACT. They name emotions ("happy", "free", "alive"), use motivational verbs ("rise", "shine", "fly"), or describe the feeling instead of its cause. They could apply to any brand and any song.

Test: if you swap the hook into a completely different brand's playlist and it still works, it's too generic. If the line could be removed and you'd still know what the song is *supposed to feel like*, rewrite it.

These shapes are almost always weak — avoid:

- "Find your [noun]" / "Feel the [noun]" / "Chase your [noun]"
- "[Verb] like never before"
- "This is where [abstract thing] begins"
- "More than [noun]" / "Beyond the [noun]"
- "Trust the [noun]" / "Sometimes [generality]"
- "It's not [X] — it's [Y]"
- Any hook that could work as an ad tagline for a car, a sneaker, AND a bank

## Mouth-feel

The hook will be sung dozens of times across a playlist. It has to feel good in the mouth.

- **Slow tempo (< 90 bpm):** longer vowels, fewer syllables per line, spacious phrasing. The singer needs room to breathe.
- **Fast tempo (> 110 bpm):** tighter consonants, more syllables, rhythmic snap. Words should want to tumble forward.
- **Minor mode:** taut, unresolved, bittersweet imagery. Not sad — *unsettled* in a way that resolves musically.
- **Major mode:** open, settled, daylight imagery. Not happy — *resolved*.

Mid-weight vowels, conversational phrasing, words land in the pocket. Say the hook aloud. If it feels like chewing cardboard, rewrite.

## Banned diction

NEVER use mood-describing adjectives in the lyric. The music's job is to convey mood. The lyric's job is to give the listener something to *be* in.

Specifically banned: easy, warm, settled, gentle, groove, peace, weightless, golden, afternoon glow, hazy, dreamy, magical, perfect (as emotional descriptor), soft (as mood-modifier).

The runtime FORBIDDEN block in the user message lists the current operator-curated ban list — overused words, cliché phrases, cliché shapes. Treat those as hard bans, not advisories. Replace with concrete sensory imagery, not synonym swaps.

## Structural variance — every batch must spread

Each batch of N hooks must use DIFFERENT structural approaches. The per-outcome direction will add outcome-specific anti-clustering rules; this section is the universal floor.

Spread deliberately across these levers — never cluster:

1. **Sentence type:** declaration, question, imperative, observation, fragment. No more than 2 of the same type per batch.
2. **Tense:** present, past, future. No more than half the batch in any one tense.
3. **Point of view:** self (I/me), other (you), collective (we), impersonal (no pronoun). No more than half the batch in any one POV.
4. **Specificity dial:** tight (names a specific named object, person, or place — Tulsa, Maria, the third step), medium (names a sensation or non-specific object — "the heavier one"), wide (names a feeling through implication — "I don't usually take this aisle"). At least one of each in batches of 6+.

If you catch yourself in a groove — similar rhythm, similar sentence shape, similar opening word, similar imagery — break the pattern hard. Change sentence type, tense, AND POV simultaneously.

## Vocal-gender tagging

Tag each hook with a vocal_gender for downstream reference-track pairing:

- "male" — uses he/him/his or has unambiguously male first-person POV
- "female" — uses she/her/hers or has unambiguously female first-person POV
- "duet" — structured as call-and-response between two voices
- null — gender-neutral, singable by any voice. **Default for the vast majority of hooks.** Only tag male/female/duet when the lyric requires it.

## Output

JSON only, via the emit_hooks tool. No prose, no markdown fences. Do not number the hooks. Each hook is its own entry.
`.trim()

export const EMIT_HOOKS_TOOL: Anthropic.Tool = {
  name: 'emit_hooks',
  description:
    'Emit the new candidate hooks. Each hook needs the text and an optional vocal_gender tag (omit when the hook is gender-neutral).',
  input_schema: {
    type: 'object',
    properties: {
      hooks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The hook line, 4–10 words.' },
            vocal_gender: {
              type: 'string',
              enum: ['male', 'female', 'duet'],
              description: 'Omit for gender-neutral hooks (the vast majority).',
            },
          },
          required: ['text'],
        },
      },
    },
    required: ['hooks'],
  },
}

export type HookVocalGender = 'male' | 'female' | 'duet' | null

export interface DraftedHook {
  text: string
  vocalGender: HookVocalGender
}

export interface DraftHooksResult {
  hooks: DraftedHook[]
  rawText: string
  /** The full user message sent (system prompt is the latest HookDrafterPrompt DB row). */
  userMessage: string
}

/**
 * Build the user message for a (icpId, outcomeId, n) target. Pulled out so
 * the system prompt + user message can be inspected in tests without firing
 * an LLM call.
 *
 * Includes: outcome title + tempo + mode, brand lyric guidelines when
 * present, per-outcome templateText (the load-bearing behavioral overlay)
 * when present, runtime FORBIDDEN block from lyric_ban_entries when present.
 *
 * Does NOT include: ICP psychographics, approved-hook exemplars,
 * rejected-hook anti-anchors, existing-hook dedup list, Outcome.dynamics
 * or Outcome.instrumentation (deprecated for style; not surfaced here either).
 */
export async function buildUserMessage(opts: { icpId: string; outcomeId: string; n: number }): Promise<string> {
  const [icp, outcome] = await Promise.all([
    prisma.iCP.findUniqueOrThrow({
      where: { id: opts.icpId },
      include: { client: { select: { brandLyricGuidelines: true } } },
    }),
    prisma.outcome.findUniqueOrThrow({ where: { id: opts.outcomeId } }),
  ])
  const lyricFactor = await prisma.outcomeLyricFactor.findUnique({
    where: { outcomeKey: outcome.outcomeKey },
    select: { templateText: true },
  })
  const overlay = lyricFactor?.templateText?.trim() || null

  const outcomeBlock = [
    `Emotional target: ${outcome.title}`,
    `Tempo: ${outcome.tempoBpm} bpm`,
    `Mode: ${outcome.mode}`,
  ].join('\n')

  const brandBlock = icp.client?.brandLyricGuidelines?.trim()
    ? `# Brand lyric guidelines\n\n${icp.client.brandLyricGuidelines.trim()}\n\n`
    : ''

  const overlayBlock = overlay
    ? `# Per-outcome lyric direction\n\nAuthoritative for content and tone on this outcome. The craft rules in the system prompt remain the floor; this is the outcome-specific layer.\n\n${overlay}\n\n`
    : ''

  const banBlock = await formatHardBanBlock()
  const forbiddenBlock = banBlock ? `# Hard bans\n\n${banBlock}\n\n` : ''

  return `# Outcome (the song's emotional target)

The hooks you write must embody and pay off the **emotional target** below.
Treat the emotional target as the controlling intent — every hook should land
inside that feeling. The musical specs (tempo / mode) are constraints the song
will be produced within; let them inform the diction, density, and image
vocabulary of the hook.

${outcomeBlock}

${brandBlock}${overlayBlock}${forbiddenBlock}# Task

Write ${opts.n} new hook candidates for this outcome. Apply the structural
variance, scene test, and diction rules from the system prompt${overlay ? ', and the per-outcome direction above' : ''}${forbiddenBlock ? ', and the hard bans above' : ''}.

Output JSON only via the emit_hooks tool.`
}

export async function draftHooks(opts: {
  icpId: string
  outcomeId: string
  n: number
}): Promise<DraftHooksResult> {
  const client = getAnthropic()

  const userMessage = await buildUserMessage(opts)

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: (await getOrSeedHookDrafterPrompt()).promptText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
    tools: [EMIT_HOOKS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_hooks' },
  })

  const toolUse = extractToolUse(response, 'emit_hooks')
  if (!toolUse) throw new Error('Hook drafter did not emit tool_use')
  const parsed = toolUse as { hooks: unknown }
  if (!Array.isArray(parsed.hooks)) throw new Error('Drafter output missing hooks array')

  const allowed: HookVocalGender[] = ['male', 'female', 'duet', null]
  const hooks: DraftedHook[] = parsed.hooks
    .map((row): DraftedHook | null => {
      if (typeof row === 'string') {
        const t = row.trim()
        return t ? { text: t, vocalGender: null } : null
      }
      if (row && typeof row === 'object') {
        const r = row as { text?: unknown; vocal_gender?: unknown }
        const text = typeof r.text === 'string' ? r.text.trim() : ''
        if (!text) return null
        const rawGender = (r as any).vocal_gender
        const vocalGender =
          rawGender === 'male' || rawGender === 'female' || rawGender === 'duet' ? rawGender : null
        if (!allowed.includes(vocalGender)) return null
        return { text, vocalGender }
      }
      return null
    })
    .filter((h): h is DraftedHook => h !== null)

  return { hooks, rawText: JSON.stringify(parsed), userMessage }
}

/** DB-backed prompt loader. Mirrors getOrSeedAnchorPrompt / getOrSeedRouterPrompt:
 *  inserts v1 from HOOK_SYSTEM_PROMPT_SEED when the table is empty, then always
 *  reads the latest version on subsequent calls. The TS const is never read at
 *  runtime after first deploy. */
export async function getOrSeedHookDrafterPrompt(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.hookDrafterPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.hookDrafterPrompt.create({
    data: {
      version: 1,
      promptText: HOOK_SYSTEM_PROMPT_SEED,
      notes: 'Auto-seeded v1 (migrated from TS const HOOK_SYSTEM_PROMPT_SEED).',
    },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}
