import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    queueItem: { findUnique: vi.fn(), create: vi.fn() },
    proofPoint: { findMany: vi.fn() },
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

import { researchTarget, queueOutreachTarget } from './outreach-queue.js'
import { prisma } from '../db.js'

const proofFindMany = prisma.proofPoint.findMany as ReturnType<typeof vi.fn>
const queueFindUnique = prisma.queueItem.findUnique as ReturnType<typeof vi.fn>
const queueCreate = prisma.queueItem.create as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

describe('researchTarget', () => {
  it('strips HTML and returns the first 2k chars of visible text', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '<html><body><script>x</script><h1>Hello</h1><p>World</p></body></html>',
    })
    const res = await researchTarget('https://example.com')
    expect(res.recentContent).not.toContain('<')
    expect(res.recentContent).toContain('Hello')
    expect(res.recentContent).toContain('World')
  })

  it('returns empty recentContent on network failure (does not throw)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(new Error('ENETUNREACH'))
    const res = await researchTarget('https://example.com')
    expect(res.recentContent).toBe('')
    expect(res.contactEmail).toBeNull()
  })

  it('extracts a contact email from the page if present', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '<p>Get in touch: host@example.com or via the form.</p>',
    })
    const res = await researchTarget('https://example.com')
    expect(res.contactEmail).toBe('host@example.com')
  })
})

describe('queueOutreachTarget', () => {
  it('drafts a pitch and writes a QueueItem', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, text: async () => '<p>Latest episode: AI in retail</p>' })
    proofFindMany.mockResolvedValue([
      { label: 'kari-lift', quoteText: '18 to 28', attribution: 'Kari' },
    ])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ angle: 'C', draft: 'Hi Brad,\n\nSaw your AI-in-retail episode...' }) }],
    })
    queueFindUnique.mockResolvedValue(null)
    queueCreate.mockResolvedValue({ id: 'q-out-1' })

    const result = await queueOutreachTarget(
      { name: 'Savvy Shopkeeper', type: 'podcast', url: 'https://savvy.example.com' },
      { apiKey: 'k' },
    )
    expect(result.queueItemId).toBe('q-out-1')
    expect(result.angle).toBe('C')
    expect(queueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'outreach',
          subtype: 'podcast',
          externalId: 'outreach:https://savvy.example.com',
          payload: expect.objectContaining({ pitchAngle: 'C' }),
        }),
      }),
    )
  })

  it('falls back to angle C when Claude returns an invalid angle', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' })
    proofFindMany.mockResolvedValue([])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ angle: 'Z', draft: 'body' }) }],
    })
    queueFindUnique.mockResolvedValue(null)
    queueCreate.mockResolvedValue({ id: 'q' })

    const result = await queueOutreachTarget(
      { name: 'T', type: 'blogger', url: 'https://t.example.com' },
      { apiKey: 'k' },
    )
    expect(result.angle).toBe('C')
  })

  it('returns the existing row when the target URL is already queued (idempotency)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' })
    proofFindMany.mockResolvedValue([])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ angle: 'A', draft: 'body' }) }],
    })
    queueFindUnique.mockResolvedValue({ id: 'q-existing' })

    const result = await queueOutreachTarget(
      { name: 'T', type: 'podcast', url: 'https://t.example.com' },
      { apiKey: 'k' },
    )
    expect(result.queueItemId).toBe('q-existing')
    expect(queueCreate).not.toHaveBeenCalled()
  })

  it('rejects unknown target types', async () => {
    await expect(queueOutreachTarget(
      { name: 'T', type: 'something' as never, url: 'https://t.example.com' },
      { apiKey: 'k' },
    )).rejects.toThrow('unknown target type')
  })
})
