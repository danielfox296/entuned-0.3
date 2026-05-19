import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    proofPoint: { findMany: vi.fn() },
    contentPiece: { findMany: vi.fn(), create: vi.fn() },
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

import { runSeoPipeline, draftBlogPost } from './seo-pipeline.js'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'

const proofFindMany = prisma.proofPoint.findMany as ReturnType<typeof vi.fn>
const contentFindMany = prisma.contentPiece.findMany as ReturnType<typeof vi.fn>
const contentCreate = prisma.contentPiece.create as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

describe('draftBlogPost', () => {
  it('parses a valid JSON response', async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        title: 'A Real Title',
        metaDescription: 'descr',
        body: 'long body text',
      }) }],
    })
    const client = new Anthropic({ apiKey: 'k' })
    const post = await draftBlogPost(client, 'sensory-retail', 'sensory marketing retail', [])
    expect(post?.title).toBe('A Real Title')
    expect(post?.body).toBe('long body text')
  })

  it('strips code fences if Claude wraps the JSON', async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify({ title: 't', metaDescription: 'm', body: 'b' }) + '\n```' }],
    })
    const client = new Anthropic({ apiKey: 'k' })
    const post = await draftBlogPost(client, 'sensory-retail', 'kw', [])
    expect(post?.title).toBe('t')
  })

  it('returns null on unparseable JSON', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] })
    const client = new Anthropic({ apiKey: 'k' })
    const post = await draftBlogPost(client, 'sensory-retail', 'kw', [])
    expect(post).toBeNull()
  })
})

describe('runSeoPipeline', () => {
  it('drafts posts for uncovered keywords in the selected cluster', async () => {
    proofFindMany.mockResolvedValue([])
    contentFindMany.mockResolvedValue([]) // nothing covered
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ title: 'T', metaDescription: 'M', body: 'B' }) }],
    })
    contentCreate.mockResolvedValue({ id: 'c' })

    const result = await runSeoPipeline({ apiKey: 'k', narratives: ['sensory-retail'] })
    // sensory-retail cluster has 5 keywords; cap at MAX_GENERATIONS_PER_RUN=8, so all 5 generated.
    expect(result.generated).toBe(5)
    expect(result.skipped).toBe(0)
    for (const call of contentCreate.mock.calls) {
      expect(call[0].data.format).toBe('blog')
      expect(call[0].data.narrative).toMatch(/^sensory-retail:/)
      expect(call[0].data.status).toBe('draft')
    }
  })

  it('skips keywords with existing matching ContentPiece narrative', async () => {
    proofFindMany.mockResolvedValue([])
    // Pre-cover one keyword in the cluster.
    contentFindMany.mockResolvedValue([
      { narrative: 'sensory-retail:sensory-marketing-retail', title: 't' },
    ])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ title: 'T', metaDescription: 'M', body: 'B' }) }],
    })
    contentCreate.mockResolvedValue({ id: 'c' })

    const result = await runSeoPipeline({ apiKey: 'k', narratives: ['sensory-retail'] })
    expect(result.generated).toBe(4)
    expect(result.skipped).toBe(1)
  })

  it('respects the MAX_GENERATIONS_PER_RUN cap across clusters', async () => {
    proofFindMany.mockResolvedValue([])
    contentFindMany.mockResolvedValue([])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ title: 'T', metaDescription: 'M', body: 'B' }) }],
    })
    contentCreate.mockResolvedValue({ id: 'c' })

    // 4 active clusters × 5 keywords = 20 candidates; cap=8.
    const result = await runSeoPipeline({ apiKey: 'k' })
    expect(result.generated).toBe(8)
  })
})
