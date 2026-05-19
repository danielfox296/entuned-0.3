// Unit + integration tests for the signal-scanner worker.
//
// Scope: scoreRelevance (pure), draftReply (with mocked Anthropic),
// runSignalScanner (with mocked fetch + Anthropic + Prisma).
//
// External I/O mocked:
//   - global fetch (Reddit JSON)
//   - @anthropic-ai/sdk (messages.create)
//   - ../db.js (prisma.queueItem.findUnique / create)

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    queueItem: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  // Anthropic is `new`-ed; the mock must be constructible. A class returning
  // the shared messagesCreate keeps the assertion surface simple.
  class MockAnthropic {
    messages = { create: messagesCreate }
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic }
})

import {
  scoreRelevance,
  draftReply,
  fetchSubredditNew,
  runSignalScanner,
} from './signal-scanner.js'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'

const queueFindUnique = prisma.queueItem.findUnique as ReturnType<typeof vi.fn>
const queueCreate = prisma.queueItem.create as ReturnType<typeof vi.fn>

const NOW = new Date('2026-05-19T15:00:00Z')

function makePost(overrides: Partial<{
  id: string; title: string; selftext: string; ups: number;
  num_comments: number; created_utc: number; subreddit: string;
}> = {}) {
  return {
    id: overrides.id ?? 'abc123',
    permalink: `/r/smallbusiness/comments/${overrides.id ?? 'abc123'}/test/`,
    title: overrides.title ?? 'What background music service do you use?',
    selftext: overrides.selftext ?? '',
    author: 'someuser',
    created_utc: overrides.created_utc ?? Math.floor(NOW.getTime() / 1000) - 3600,
    ups: overrides.ups ?? 5,
    num_comments: overrides.num_comments ?? 3,
    subreddit: overrides.subreddit ?? 'smallbusiness',
  }
}

describe('scoreRelevance', () => {
  it('returns 0 when no keywords match', () => {
    const post = makePost({ title: 'How do I file taxes for an LLC?', selftext: '' })
    const result = scoreRelevance(post, NOW)
    expect(result.score).toBe(0)
    expect(result.matched).toEqual([])
  })

  it('scores higher for keyword-in-title than keyword-in-body', () => {
    const titleMatch = makePost({
      id: 't1',
      title: 'background music service recommendations?',
      selftext: '',
    })
    const bodyMatch = makePost({
      id: 'b1',
      title: 'random retail question',
      selftext: 'looking for a background music service for my shop',
    })
    expect(scoreRelevance(titleMatch, NOW).score).toBeGreaterThan(
      scoreRelevance(bodyMatch, NOW).score,
    )
  })

  it('penalizes stale posts heavily', () => {
    const fresh = makePost({
      id: 'f',
      created_utc: Math.floor(NOW.getTime() / 1000) - 3600,
      title: 'background music service for my store',
    })
    const stale = makePost({
      id: 's',
      created_utc: Math.floor(NOW.getTime() / 1000) - 36 * 3600,
      title: 'background music service for my store',
    })
    expect(scoreRelevance(fresh, NOW).score).toBeGreaterThan(
      scoreRelevance(stale, NOW).score,
    )
  })

  it('captures every matched keyword', () => {
    const post = makePost({
      title: 'Mood Media vs Soundtrack Your Brand for in-store music?',
      selftext: '',
    })
    const { matched } = scoreRelevance(post, NOW)
    expect(matched).toEqual(expect.arrayContaining(['Mood Media', 'Soundtrack Your Brand', 'in-store music']))
  })
})

describe('fetchSubredditNew', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns parsed children data on success', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            { data: makePost({ id: 'p1' }) },
            { data: makePost({ id: 'p2' }) },
          ],
        },
      }),
    })
    const posts = await fetchSubredditNew('smallbusiness')
    expect(posts).toHaveLength(2)
    expect(posts[0].id).toBe('p1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('r/smallbusiness/new.json'),
      expect.objectContaining({ headers: expect.objectContaining({ 'user-agent': expect.any(String) }) }),
    )
  })

  it('returns [] on 429 without throwing (rate-limit tolerance)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: false, status: 429 })
    const posts = await fetchSubredditNew('smallbusiness')
    expect(posts).toEqual([])
  })

  it('throws on other non-OK statuses', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    await expect(fetchSubredditNew('smallbusiness')).rejects.toThrow('500')
  })
})

describe('draftReply', () => {
  beforeEach(() => {
    messagesCreate.mockReset()
  })

  it('returns the assembled text on a normal completion', async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'we use Cloud Cover and it is fine but the loop is short.' }],
    })
    const client = new Anthropic({ apiKey: 'k' })
    const out = await draftReply(client, {
      postTitle: 't', postBody: 'b', subreddit: 'smallbusiness', matchedKeywords: ['music'], lane: 'pitch',
    })
    expect(out).toBe('we use Cloud Cover and it is fine but the loop is short.')
  })

  it('returns null when Claude outputs SKIP verbatim', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'SKIP' }] })
    const client = new Anthropic({ apiKey: 'k' })
    const out = await draftReply(client, {
      postTitle: 't', postBody: 'b', subreddit: 'smallbusiness', matchedKeywords: ['music'], lane: 'pitch',
    })
    expect(out).toBeNull()
  })

  it('returns null when Claude outputs an empty response', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '   ' }] })
    const client = new Anthropic({ apiKey: 'k' })
    const out = await draftReply(client, {
      postTitle: 't', postBody: 'b', subreddit: 'smallbusiness', matchedKeywords: ['music'], lane: 'pitch',
    })
    expect(out).toBeNull()
  })
})

describe('runSignalScanner', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    messagesCreate.mockReset()
    queueFindUnique.mockReset()
    queueCreate.mockReset()
  })

  it('queues a high-relevance post with the drafted reply', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    // First subreddit returns one strong-match post; others return [].
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/search.json')) {
        return {
          ok: true,
          json: async () => ({
            data: { children: [{ data: makePost({
              id: 'hot1',
              title: 'background music service for retail — what do you all use?',
              selftext: 'we need something better than spotify',
              ups: 30, num_comments: 12,
              created_utc: Math.floor(NOW.getTime() / 1000) - 2 * 3600,
            }) }] },
          }),
        }
      }
      return { ok: true, json: async () => ({ data: { children: [] } }) }
    })
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'we tried a few. cloud cover is rough on repetition.' }],
    })
    queueFindUnique.mockResolvedValue(null)
    queueCreate.mockResolvedValue({ id: 'q-new' })

    const result = await runSignalScanner({ apiKey: 'k', now: NOW })
    expect(result.matched).toBe(1)
    expect(result.drafted).toBe(1)
    expect(result.queued).toBe(1)
    expect(queueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'signal',
          subtype: 'reddit',
          externalId: 't3_hot1',
          draftContent: expect.stringContaining('cloud cover'),
          payload: expect.objectContaining({ relevanceScore: expect.any(Number) }),
        }),
      }),
    )
  })

  it('does not re-queue posts already in the queue (idempotency on externalId)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/search.json')) {
        return {
          ok: true,
          json: async () => ({
            data: { children: [{ data: makePost({
              id: 'dup1',
              title: 'background music service for retail',
              created_utc: Math.floor(NOW.getTime() / 1000) - 3600,
              ups: 30, num_comments: 5,
            }) }] },
          }),
        }
      }
      return { ok: true, json: async () => ({ data: { children: [] } }) }
    })
    queueFindUnique.mockResolvedValue({ id: 'q-existing', externalId: 't3_dup1' })

    const result = await runSignalScanner({ apiKey: 'k', now: NOW })
    expect(result.matched).toBe(1)
    expect(result.queued).toBe(0)
    expect(result.skipped).toBe(1)
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(queueCreate).not.toHaveBeenCalled()
  })

  it('skips stale posts older than SIGNAL_MAX_AGE_HOURS without LLM call', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/search.json')) {
        return {
          ok: true,
          json: async () => ({
            data: { children: [{ data: makePost({
              id: 'old1',
              title: 'background music service for retail',
              created_utc: Math.floor(NOW.getTime() / 1000) - 60 * 3600, // 60h ago, > 48
            }) }] },
          }),
        }
      }
      return { ok: true, json: async () => ({ data: { children: [] } }) }
    })

    const result = await runSignalScanner({ apiKey: 'k', now: NOW })
    expect(result.matched).toBe(0)
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(queueCreate).not.toHaveBeenCalled()
  })

  // Two-lane behavior: posts scoring 20-49 should still get a draft, but in
  // the "helpful" lane (no-pitch). This is the System 7 / community work
  // from the spec — show up as a useful presence, don't try to sell.
  it('uses the helpful lane (no-pitch) for medium-relevance posts', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/search.json')) {
        return {
          ok: true,
          json: async () => ({
            data: { children: [{ data: makePost({
              id: 'med1',
              // Title with one match + body with one match → moderate score.
              // Lower engagement keeps it under the pitch threshold (50).
              title: 'opening a clothing shop — store ambiance ideas?',
              selftext: 'also curious about background music if anyone has opinions',
              ups: 1, num_comments: 1,
              created_utc: Math.floor(NOW.getTime() / 1000) - 10 * 3600,
            }) }] },
          }),
        }
      }
      return { ok: true, json: async () => ({ data: { children: [] } }) }
    })
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'we use a small streamer and rotate every week or two. helps a lot.' }],
    })
    queueFindUnique.mockResolvedValue(null)
    queueCreate.mockResolvedValue({ id: 'q-helpful' })

    const result = await runSignalScanner({ apiKey: 'k', now: NOW })
    expect(result.queued).toBe(1)
    const call = queueCreate.mock.calls[0][0]
    // Subtype distinguishes the lane so the helpful queue can't accidentally
    // get re-edited into pitch language later.
    expect(call.data.subtype).toBe('reddit-helpful')
    expect(call.data.title).toMatch(/^\[helpful\]/)
    expect(call.data.payload.lane).toBe('helpful')
  })

  it('drops items where Claude says SKIP — does not queue zombie rows', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/search.json')) {
        return {
          ok: true,
          json: async () => ({
            data: { children: [{ data: makePost({
              id: 'skipme',
              title: 'background music service for retail',
              created_utc: Math.floor(NOW.getTime() / 1000) - 3600,
              ups: 30, num_comments: 12,
            }) }] },
          }),
        }
      }
      return { ok: true, json: async () => ({ data: { children: [] } }) }
    })
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'SKIP' }] })
    queueFindUnique.mockResolvedValue(null)

    const result = await runSignalScanner({ apiKey: 'k', now: NOW })
    expect(result.matched).toBe(1)
    expect(result.queued).toBe(0)
    expect(queueCreate).not.toHaveBeenCalled()
  })

  it('refuses to run without ANTHROPIC_API_KEY', async () => {
    const prev = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      await expect(runSignalScanner()).rejects.toThrow('ANTHROPIC_API_KEY')
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev
    }
  })
})
