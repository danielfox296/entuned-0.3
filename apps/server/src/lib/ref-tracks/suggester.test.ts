import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    iCP: { findUniqueOrThrow: vi.fn() },
    referenceTrackPrompt: { findFirst: vi.fn(), create: vi.fn() },
    referenceTrack: { findMany: vi.fn(), createMany: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { suggestReferenceTracks, REFERENCE_TRACK_PROMPT_SEED, EMIT_SUGGESTIONS_TOOL } from './suggester.js'
import { _resetAnthropicForTests } from '../_llm/client.js'
import { prisma } from '../../db.js'

const icpFind = prisma.iCP.findUniqueOrThrow as ReturnType<typeof vi.fn>
const promptFind = prisma.referenceTrackPrompt.findFirst as ReturnType<typeof vi.fn>
const refFindMany = prisma.referenceTrack.findMany as ReturnType<typeof vi.fn>
const refCreateMany = prisma.referenceTrack.createMany as ReturnType<typeof vi.fn>

const ICP_ID = '11111111-1111-1111-1111-111111111111'

function setupFixtures() {
  icpFind.mockResolvedValue({
    id: ICP_ID,
    name: '1. Marissa',
    ageRange: '35-50',
    location: 'Denver, suburban',
    politicalSpectrum: 'center-left',
    openness: 'high',
    fears: 'wasting money on the wrong choice',
    values: 'craftsmanship, longevity',
    desires: 'a wardrobe that lasts',
    unexpressedDesires: 'permission to spend on herself',
    turnOffs: 'pushy salespeople',
    client: {},
  })
  promptFind.mockResolvedValue({ id: 'p1', version: 1, templateText: REFERENCE_TRACK_PROMPT_SEED })
  refFindMany.mockResolvedValue([])
  refCreateMany.mockResolvedValue({ count: 0 })
}

function toolUseResponse(input: Record<string, unknown>) {
  return { content: [{ type: 'tool_use', name: 'emit_suggestions', input }] }
}

describe('suggestReferenceTracks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The shared Anthropic client is memoized; reset it so per-test
    // ANTHROPIC_API_KEY state is honored rather than served from cache.
    _resetAnthropicForTests()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    setupFixtures()
  })

  it('parses emitted suggestions, persists them, and reports the created count', async () => {
    messagesCreate.mockResolvedValue(
      toolUseResponse({
        PreFormation: [{ artist: 'The Band', title: 'The Weight', year: 1968, rationale: 'household classic' }],
        FormationEra: [{ artist: 'Steely Dan', title: 'Peg', year: 1977, rationale: 'formation-era staple' }],
        Adjacent: [{ artist: 'Portishead', title: 'Roads', year: 1994, vector: 'cultural break', rationale: 'breaks genre, holds mood' }],
      }),
    )

    const result = await suggestReferenceTracks({ icpId: ICP_ID })

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(result.createdCount).toBe(3)
    expect(result.promptVersion).toBe(1)
    // raw is the JSON-stringified tool input
    expect(JSON.parse(result.rawText).PreFormation[0].title).toBe('The Weight')

    expect(refCreateMany).toHaveBeenCalledTimes(1)
    const rows = refCreateMany.mock.calls[0][0].data
    expect(rows).toHaveLength(3)
    expect(rows.every((r: any) => r.status === 'pending' && r.icpId === ICP_ID)).toBe(true)
    expect(rows.map((r: any) => r.title)).toEqual(['The Weight', 'Peg', 'Roads'])
  })

  it('does NOT pass any whitespace-only stop_sequence (Anthropic rejects those)', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse({ PreFormation: [] }))
    await suggestReferenceTracks({ icpId: ICP_ID })

    const call = messagesCreate.mock.calls[0][0]
    // Forced tool output needs no prose-tail cutter; the field must be absent
    // (or, if present, contain only non-whitespace sequences).
    if (call.stop_sequences !== undefined) {
      for (const s of call.stop_sequences) {
        expect(s.trim().length).toBeGreaterThan(0)
      }
    }
    expect(call.stop_sequences).toBeUndefined()
  })

  it('forces the emit_suggestions tool and sends the seed system prompt', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse({ PreFormation: [] }))
    await suggestReferenceTracks({ icpId: ICP_ID })

    const call = messagesCreate.mock.calls[0][0]
    expect(call.tools).toEqual([EMIT_SUGGESTIONS_TOOL])
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_suggestions' })
    expect(call.system[0].text).toBe(REFERENCE_TRACK_PROMPT_SEED)
  })

  it('throws when the model returns no tool_use block', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not a tool use' }] })
    await expect(suggestReferenceTracks({ icpId: ICP_ID })).rejects.toThrow('did not emit tool_use')
  })

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(suggestReferenceTracks({ icpId: ICP_ID })).rejects.toThrow('ANTHROPIC_API_KEY is not set')
  })
})
