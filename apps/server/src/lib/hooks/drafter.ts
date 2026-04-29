// Hook Drafter — generates N candidate hooks for (ICP, Outcome) using Claude.
// The system prompt comes from HookDrafterPrompt.promptText (per-ICP, editable).
// The user message bundles ICP psychographic profile + outcome physiology + brand
// guidelines + the existing approved-hook list (so the model can vary).

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../../db.js'

const MODEL = process.env.HOOK_DRAFTER_MODEL ?? 'claude-sonnet-4-5'

export const HOOK_WRITER_PROMPT_SEED = `
You write hook lines for a brand's in-store music. A hook becomes the chorus of the
song; lyrics are written around it later by a separate process.

A great hook:
- Is 4–10 words. Concrete. Image-first.
- Sounds like something a real person would say, not a slogan.
- Lands as a payoff, not a setup. The earlier verses build toward it.
- Embodies the brand's values rather than naming them.

NEVER write the phrase "good with that, just the way you are" or any close paraphrase.
That phrase is permanently banned by editorial decision.

Output JSON only: { "hooks": ["...", "...", ...] }. No prose, no markdown fences.
Each string is one hook. Do not number them. Do not repeat any hook from the
existing-hooks list.
`.trim()

export async function getOrSeedHookWriterPrompt(icpId: string): Promise<{ id: string; icpId: string; promptText: string }> {
  const existing = await prisma.hookWriterPrompt.findUnique({ where: { icpId } })
  if (existing) return existing
  return prisma.hookWriterPrompt.create({
    data: { icpId, promptText: HOOK_WRITER_PROMPT_SEED },
  })
}

export interface DraftHooksResult {
  hooks: string[]
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

Write ${opts.n} new hook candidates for this ICP + Outcome. Vary in approach
(image vs. statement vs. question vs. quiet observation). Output JSON only.`

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

  const hooks = parsed.hooks.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).map((h) => h.trim())
  return { hooks, rawText: raw, promptUsed: systemPrompt }
}
