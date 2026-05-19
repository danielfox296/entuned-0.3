import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    queueItem: { findUnique: vi.fn(), create: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic }
})

import { runTriggerMonitor, type SearchProvider } from './trigger-monitor.js'
import { prisma } from '../db.js'

const queueFindUnique = prisma.queueItem.findUnique as ReturnType<typeof vi.fn>
const queueCreate = prisma.queueItem.create as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

function fakeProvider(hits: { title: string; url: string; snippet: string }[]): SearchProvider {
  return {
    search: vi.fn().mockResolvedValue(hits),
  }
}

describe('runTriggerMonitor', () => {
  it('returns noSearchProvider=true when SERPAPI_KEY is unset and no provider passed', async () => {
    const prev = process.env.SERPAPI_KEY
    delete process.env.SERPAPI_KEY
    try {
      const result = await runTriggerMonitor({ apiKey: 'k' })
      expect(result.noSearchProvider).toBe(true)
      expect(result.queued).toBe(0)
    } finally {
      if (prev !== undefined) process.env.SERPAPI_KEY = prev
    }
  })

  it('queues categorized hits with subtype = triggerType', async () => {
    const provider = fakeProvider([
      { title: 'Bloom Boutique opens in RiNo', url: 'https://denverpost.example/bloom', snippet: 'new boutique opens this week...' },
    ])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        triggerType: 'new_store',
        businessName: 'Bloom Boutique',
        location: 'RiNo, Denver',
        whyWarm: 'Just opened — high need for store identity.',
        draft: 'Hey — saw Bloom Boutique just opened in RiNo. Congrats. Quick note...',
      }) }],
    })
    queueFindUnique.mockResolvedValue(null)
    queueCreate.mockResolvedValue({ id: 'q' })

    const result = await runTriggerMonitor({ apiKey: 'k', provider })
    expect(result.queued).toBeGreaterThan(0)
    expect(queueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'trigger',
          subtype: 'new_store',
          payload: expect.objectContaining({ businessName: 'Bloom Boutique' }),
        }),
      }),
    )
  })

  it('drops hits Claude flags as "skip"', async () => {
    const provider = fakeProvider([
      { title: 'unrelated', url: 'https://example.com/x', snippet: 'unrelated content' },
    ])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ triggerType: 'skip', businessName: null, location: null, whyWarm: '', draft: '' }) }],
    })
    queueFindUnique.mockResolvedValue(null)

    const result = await runTriggerMonitor({ apiKey: 'k', provider })
    expect(result.queued).toBe(0)
    expect(result.skipped).toBeGreaterThan(0)
    expect(queueCreate).not.toHaveBeenCalled()
  })

  it('skips already-queued URLs via externalId lookup (idempotency)', async () => {
    const provider = fakeProvider([
      { title: 'Already queued', url: 'https://example.com/dup', snippet: '...' },
    ])
    queueFindUnique.mockResolvedValue({ id: 'q-existing' })

    const result = await runTriggerMonitor({ apiKey: 'k', provider })
    expect(result.queued).toBe(0)
    expect(result.skipped).toBeGreaterThan(0)
    expect(messagesCreate).not.toHaveBeenCalled()
  })
})
