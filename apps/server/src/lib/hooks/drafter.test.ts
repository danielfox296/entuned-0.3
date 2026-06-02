import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    iCP: { findUniqueOrThrow: vi.fn() },
    outcome: { findUniqueOrThrow: vi.fn() },
    outcomeLyricFactor: { findUnique: vi.fn() },
    hookDrafterPrompt: { findFirst: vi.fn(), create: vi.fn() },
    lyricBanEntry: { findMany: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { buildUserMessage, draftHooks, HOOK_SYSTEM_PROMPT_SEED, EMIT_HOOKS_TOOL } from './drafter.js'
import { _resetAnthropicForTests } from '../_llm/client.js'
import { prisma } from '../../db.js'

const icpFind = prisma.iCP.findUniqueOrThrow as ReturnType<typeof vi.fn>
const outcomeFind = prisma.outcome.findUniqueOrThrow as ReturnType<typeof vi.fn>
const factorFind = prisma.outcomeLyricFactor.findUnique as ReturnType<typeof vi.fn>
const hookDrafterPromptFind = prisma.hookDrafterPrompt.findFirst as ReturnType<typeof vi.fn>
const banFind = prisma.lyricBanEntry.findMany as ReturnType<typeof vi.fn>

const ICP_ID = '11111111-1111-1111-1111-111111111111'
const OUTCOME_ID = '22222222-2222-2222-2222-222222222222'
const OUTCOME_KEY = '33333333-3333-3333-3333-333333333333'

function setupFixtures(opts: {
  brandLyricGuidelines?: string | null
  templateText?: string | null
  // ICP psychographics — set to verify they DON'T leak into the user message
  fears?: string
  values?: string
  desires?: string
  unexpressedDesires?: string
  turnOffs?: string
  ageRange?: string
  location?: string
  politicalSpectrum?: string
  openness?: string
}) {
  icpFind.mockResolvedValue({
    id: ICP_ID,
    name: '1. Marissa',
    ageRange: opts.ageRange ?? '35-50',
    location: opts.location ?? 'Denver, suburban',
    politicalSpectrum: opts.politicalSpectrum ?? 'center-left',
    openness: opts.openness ?? 'high',
    fears: opts.fears ?? 'wasting money on the wrong choice',
    values: opts.values ?? 'craftsmanship, longevity',
    desires: opts.desires ?? 'a wardrobe that lasts',
    unexpressedDesires: opts.unexpressedDesires ?? 'permission to spend on herself',
    turnOffs: opts.turnOffs ?? 'pushy salespeople',
    client: { brandLyricGuidelines: opts.brandLyricGuidelines ?? null },
  })
  outcomeFind.mockResolvedValue({
    id: OUTCOME_ID,
    outcomeKey: OUTCOME_KEY,
    title: 'Dwell Extension',
    tempoBpm: 66,
    mode: 'minor',
    dynamics: 'soft',
    instrumentation: 'fingerpicked acoustic guitar, upright bass',
  })
  factorFind.mockResolvedValue(
    opts.templateText === undefined
      ? null
      : { templateText: opts.templateText ?? '' },
  )
}

describe('buildUserMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    banFind.mockResolvedValue([])
  })

  it('includes the outcome emotional target, tempo, mode', async () => {
    setupFixtures({})
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 5 })
    expect(msg).toContain('Emotional target: Dwell Extension')
    expect(msg).toContain('Tempo: 66 bpm')
    expect(msg).toContain('Mode: minor')
    expect(msg).toContain('Write 5 new hook candidates')
  })

  it('does NOT include Outcome.dynamics or Outcome.instrumentation (deprecated for style; not surfaced to hooks)', async () => {
    setupFixtures({})
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 5 })
    expect(msg).not.toContain('Dynamics:')
    expect(msg).not.toContain('Instrumentation:')
  })

  it('injects the FORBIDDEN block from lyric_ban_entries when present', async () => {
    banFind.mockResolvedValueOnce([
      { category: 'overused_word', text: 'glow' },
      { category: 'cliche_phrase', text: 'good with that, just the way you are' },
    ])
    setupFixtures({})
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).toContain('# Hard bans')
    expect(msg).toContain('FORBIDDEN')
    expect(msg).toContain('glow')
    expect(msg).toContain('good with that, just the way you are')
    expect(msg).toContain('the hard bans above')
  })

  it('still injects FORBIDDEN block from TS constants when lyric_ban_entries is empty (cold-start fallback)', async () => {
    // loadBanEntries() falls back to OVERUSED_WORDS / AI_CLICHE_PHRASES /
    // AI_CLICHE_SHAPES when the DB table is empty, so the FORBIDDEN block is
    // always present in practice — never raw-shipped without ban guidance.
    banFind.mockResolvedValueOnce([])
    setupFixtures({})
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).toContain('# Hard bans')
    expect(msg).toContain('FORBIDDEN')
  })

  it('includes the per-outcome templateText block when present', async () => {
    setupFixtures({
      templateText:
        'Hooks for this outcome stretch a moment. Sensory seed: the second glass of wine when you have stopped counting.',
    })
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).toContain('# Per-outcome lyric direction')
    expect(msg).toContain('second glass of wine when you have stopped counting')
    expect(msg).toContain('the per-outcome direction above')
  })

  it('omits the per-outcome block when templateText is missing or empty', async () => {
    setupFixtures({ templateText: '' })
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).not.toContain('# Per-outcome lyric direction')

    setupFixtures({ templateText: null })
    const msg2 = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg2).not.toContain('# Per-outcome lyric direction')
  })

  it('includes brand lyric guidelines when present', async () => {
    setupFixtures({ brandLyricGuidelines: 'Conversational, unfussy, never preachy.' })
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).toContain('# Brand lyric guidelines')
    expect(msg).toContain('Conversational, unfussy, never preachy.')
  })

  it('omits brand block when guidelines are empty', async () => {
    setupFixtures({ brandLyricGuidelines: null })
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).not.toContain('# Brand lyric guidelines')
  })

  it('does NOT include ICP psychographics (fears, values, desires, etc.) in any form', async () => {
    setupFixtures({
      fears: 'UNIQUE-FEAR-MARKER-fpsHCQ',
      values: 'UNIQUE-VALUES-MARKER-fpsHCQ',
      desires: 'UNIQUE-DESIRES-MARKER-fpsHCQ',
      unexpressedDesires: 'UNIQUE-UNEXPRESSED-MARKER-fpsHCQ',
      turnOffs: 'UNIQUE-TURNOFFS-MARKER-fpsHCQ',
      ageRange: 'UNIQUE-AGE-MARKER-fpsHCQ',
      location: 'UNIQUE-LOCATION-MARKER-fpsHCQ',
      politicalSpectrum: 'UNIQUE-POLITICAL-MARKER-fpsHCQ',
      openness: 'UNIQUE-OPENNESS-MARKER-fpsHCQ',
    })
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).not.toMatch(/UNIQUE-.*-MARKER-fpsHCQ/)
    // Also: the ICP name "1. Marissa" should not appear
    expect(msg).not.toContain('1. Marissa')
    expect(msg).not.toContain('Marissa')
  })

  it('does NOT include approved-exemplars or rejected-anti-anchors blocks', async () => {
    setupFixtures({})
    const msg = await buildUserMessage({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(msg).not.toContain('Approved hooks')
    expect(msg).not.toContain('anchor on these')
    expect(msg).not.toContain('Rejected hooks')
    expect(msg).not.toContain('write more in this voice')
    expect(msg).not.toContain('do not repeat')
  })
})

describe('HOOK_SYSTEM_PROMPT_SEED', () => {
  it('contains the universal craft sections', () => {
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('## What a great hook is')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('## What a weak hook is')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('## Mouth-feel')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('## Banned diction')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('## Structural variance')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('## Vocal-gender tagging')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('## Output')
  })

  it('lets the per-outcome direction be authoritative on content', () => {
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('per-outcome lyric direction')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('authoritative on content and tone')
  })

  it('includes the 2010s-cliché shape bans (Trust the X / Sometimes Y / It is not X)', () => {
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('Trust the [noun]')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('Sometimes [generality]')
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain("It's not [X] — it's [Y]")
  })

  it('points the model at the runtime FORBIDDEN block (ban content lives in lyric_ban_entries, not the seed)', () => {
    expect(HOOK_SYSTEM_PROMPT_SEED).toContain('runtime FORBIDDEN block')
    // The permanent "good with that" ban lives as a lyric_ban_entries row, not
    // hardcoded here; the seed text must not reintroduce it.
    expect(HOOK_SYSTEM_PROMPT_SEED).not.toContain('good with that, just the way you are')
  })

  it('includes the three-things-a-hook-does framing (names a thing / describes a moment / speaks a direct behavior)', () => {
    expect(HOOK_SYSTEM_PROMPT_SEED).toMatch(/Names a thing/i)
    expect(HOOK_SYSTEM_PROMPT_SEED).toMatch(/Describes a moment/i)
    expect(HOOK_SYSTEM_PROMPT_SEED).toMatch(/Speaks a direct behavior/i)
  })
})

describe('EMIT_HOOKS_TOOL', () => {
  it('declares the emit_hooks tool with text + optional vocal_gender per hook', () => {
    expect(EMIT_HOOKS_TOOL.name).toBe('emit_hooks')
    const props = EMIT_HOOKS_TOOL.input_schema.properties as any
    expect(props.hooks.type).toBe('array')
    const itemProps = props.hooks.items.properties
    expect(itemProps.text.type).toBe('string')
    expect(itemProps.vocal_gender.enum).toEqual(['male', 'female', 'duet'])
    expect(props.hooks.items.required).toEqual(['text'])
  })
})

function toolUseResponse(hooks: Array<{ text: string; vocal_gender?: string }>) {
  return {
    content: [{ type: 'tool_use', name: 'emit_hooks', input: { hooks } }],
  }
}

describe('draftHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The shared Anthropic client is memoized; reset it so the per-test
    // ANTHROPIC_API_KEY state (set here / deleted in the unset-key test) is
    // honored on the next getAnthropic() call rather than served from cache.
    _resetAnthropicForTests()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    // Seed the DB-backed hook drafter prompt so the loader short-circuits to
    // the existing row (avoids hitting prisma.create in the mock).
    hookDrafterPromptFind.mockResolvedValue({ version: 1, promptText: HOOK_SYSTEM_PROMPT_SEED })
    banFind.mockResolvedValue([])
  })

  it('calls Anthropic with HOOK_SYSTEM_PROMPT_SEED and the built user message', async () => {
    setupFixtures({})
    messagesCreate.mockResolvedValue(toolUseResponse([{ text: 'a hook here' }]))
    await draftHooks({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 5 })
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    const call = messagesCreate.mock.calls[0][0]
    expect(call.system[0].text).toBe(HOOK_SYSTEM_PROMPT_SEED)
    expect(call.messages[0].content).toContain('Emotional target: Dwell Extension')
    expect(call.tools).toEqual([EMIT_HOOKS_TOOL])
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_hooks' })
  })

  it('normalizes vocal_gender: "male"/"female"/"duet" pass through; other/missing become null', async () => {
    setupFixtures({})
    messagesCreate.mockResolvedValue(
      toolUseResponse([
        { text: 'male hook', vocal_gender: 'male' },
        { text: 'female hook', vocal_gender: 'female' },
        { text: 'duet hook', vocal_gender: 'duet' },
        { text: 'plain hook' }, // missing vocal_gender → null
        { text: 'garbage hook', vocal_gender: 'something-weird' } as any, // invalid → null
      ]),
    )
    const result = await draftHooks({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 5 })
    expect(result.hooks).toEqual([
      { text: 'male hook', vocalGender: 'male' },
      { text: 'female hook', vocalGender: 'female' },
      { text: 'duet hook', vocalGender: 'duet' },
      { text: 'plain hook', vocalGender: null },
      { text: 'garbage hook', vocalGender: null },
    ])
  })

  it('returns ALL emitted hooks — no surface dedup filtering', async () => {
    setupFixtures({})
    messagesCreate.mockResolvedValue(
      toolUseResponse([
        { text: 'one hook' },
        { text: 'one hook' }, // exact duplicate — still returned
        { text: 'one hook longer' }, // shares trigrams — still returned
      ]),
    )
    const result = await draftHooks({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(result.hooks).toHaveLength(3)
  })

  it('drops empty-string hooks (defensive cleanup, not dedup)', async () => {
    setupFixtures({})
    messagesCreate.mockResolvedValue(
      toolUseResponse([
        { text: 'real hook' },
        { text: '' }, // empty
        { text: '   ' }, // whitespace
      ]),
    )
    const result = await draftHooks({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 3 })
    expect(result.hooks).toEqual([{ text: 'real hook', vocalGender: null }])
  })

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    setupFixtures({})
    await expect(draftHooks({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 1 })).rejects.toThrow(
      'ANTHROPIC_API_KEY is not set',
    )
  })

  it('throws when the model returns no tool_use block', async () => {
    setupFixtures({})
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not a tool use' }] })
    await expect(draftHooks({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 1 })).rejects.toThrow(
      'did not emit tool_use',
    )
  })

  it('throws when the tool_use input has no hooks array', async () => {
    setupFixtures({})
    messagesCreate.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'emit_hooks', input: { notHooks: [] } }],
    })
    await expect(draftHooks({ icpId: ICP_ID, outcomeId: OUTCOME_ID, n: 1 })).rejects.toThrow(
      'missing hooks array',
    )
  })
})
