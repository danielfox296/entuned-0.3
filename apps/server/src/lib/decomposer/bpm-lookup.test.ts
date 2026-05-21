import { describe, it, expect, vi, beforeEach } from 'vitest'

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { lookupBpm, normalizeBpm, normalizeConfidence } from './bpm-lookup.js'

function emitBpmResponse(bpm: number | null, confidence: string) {
  return {
    model: 'claude-haiku-4-5-20251001',
    content: [
      { type: 'tool_use', name: 'emit_bpm', input: { bpm, confidence } },
    ],
  }
}

describe('normalizeBpm', () => {
  it('rounds floats to nearest integer', () => {
    expect(normalizeBpm(92.4)).toBe(92)
    expect(normalizeBpm(92.6)).toBe(93)
  })

  it('drops null, undefined, non-numbers', () => {
    expect(normalizeBpm(null)).toBeNull()
    expect(normalizeBpm(undefined)).toBeNull()
    expect(normalizeBpm('120')).toBeNull()
    expect(normalizeBpm(NaN)).toBeNull()
    expect(normalizeBpm(Infinity)).toBeNull()
  })

  it('drops out-of-range BPMs (must be in (0, 300])', () => {
    expect(normalizeBpm(0)).toBeNull()
    expect(normalizeBpm(-50)).toBeNull()
    expect(normalizeBpm(301)).toBeNull()
    expect(normalizeBpm(1)).toBe(1)
    expect(normalizeBpm(300)).toBe(300)
  })
})

describe('normalizeConfidence', () => {
  it('passes through the three valid values', () => {
    expect(normalizeConfidence('low')).toBe('low')
    expect(normalizeConfidence('medium')).toBe('medium')
    expect(normalizeConfidence('high')).toBe('high')
  })

  it('coerces anything else to low', () => {
    expect(normalizeConfidence('unknown')).toBe('low')
    expect(normalizeConfidence(null)).toBe('low')
    expect(normalizeConfidence(undefined)).toBe('low')
    expect(normalizeConfidence(42)).toBe('low')
  })
})

describe('lookupBpm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('returns the model-emitted bpm + confidence', async () => {
    messagesCreate.mockResolvedValueOnce(emitBpmResponse(92, 'high'))

    const result = await lookupBpm({ artist: 'Test Artist', title: 'Test Track', year: 2015 })

    expect(result.bpm).toBe(92)
    expect(result.confidence).toBe('high')
  })

  it('rounds float BPMs from the model', async () => {
    messagesCreate.mockResolvedValueOnce(emitBpmResponse(92.7 as any, 'medium'))

    const result = await lookupBpm({ artist: 'A', title: 'B' })

    expect(result.bpm).toBe(93)
  })

  it('returns null bpm + low confidence when the model emits null', async () => {
    messagesCreate.mockResolvedValueOnce(emitBpmResponse(null, 'low'))

    const result = await lookupBpm({ artist: 'Obscure', title: 'Unknown' })

    expect(result.bpm).toBeNull()
    expect(result.confidence).toBe('low')
  })

  it('demotes confidence to low when the model returns an out-of-range BPM', async () => {
    messagesCreate.mockResolvedValueOnce(emitBpmResponse(9999 as any, 'high'))

    const result = await lookupBpm({ artist: 'A', title: 'B' })

    expect(result.bpm).toBeNull()
    expect(result.confidence).toBe('low')
  })

  it('returns null + low confidence when no emit_bpm tool_use is present', async () => {
    messagesCreate.mockResolvedValueOnce({
      model: 'claude-haiku-4-5-20251001',
      content: [{ type: 'text', text: 'I could not find this track' }],
    })

    const result = await lookupBpm({ artist: 'Ghost', title: 'Vapor' })

    expect(result.bpm).toBeNull()
    expect(result.confidence).toBe('low')
  })

  it('uses Haiku 4.5 by default + a tiny prompt + 1 web_search use cap', async () => {
    messagesCreate.mockResolvedValueOnce(emitBpmResponse(120, 'high'))

    await lookupBpm({ artist: 'Test', title: 'Track' })

    const call = messagesCreate.mock.calls[0][0]
    expect(call.model).toBe('claude-haiku-4-5-20251001')
    expect(call.max_tokens).toBe(400)
    // System prompt must stay compact — backfill is cheap because the prompt is tiny.
    expect(call.system[0].text.length).toBeLessThan(1500)
    // Exactly one web_search tool, capped at 1 use.
    const searchTool = call.tools.find((t: any) => t.name === 'web_search')
    expect(searchTool).toBeDefined()
    expect(searchTool.max_uses).toBe(1)
  })
})
