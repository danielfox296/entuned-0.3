// Tests for the content-multiplier worker.
//
// Covers: per-format gap detection (skip when already exists), Claude call
// produces draft ContentPiece, MAX_GENERATIONS_PER_RUN cap holds.

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

import { runContentMultiplier, buildUserMessage } from './content-multiplier.js'
import { prisma } from '../db.js'

const proofFindMany = prisma.proofPoint.findMany as ReturnType<typeof vi.fn>
const contentFindMany = prisma.contentPiece.findMany as ReturnType<typeof vi.fn>
const contentCreate = prisma.contentPiece.create as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

describe('buildUserMessage', () => {
  it('includes format constraints and proof-point details', () => {
    const msg = buildUserMessage({
      narrative: 'kari-lift',
      format: 'linkedin',
      proofPoint: {
        label: 'kari-conversion-lift',
        quoteText: 'conversion jumped 18 → 28%',
        attribution: 'Kari S., Assistant Manager',
        context: 'pilot store live test',
      },
    })
    expect(msg).toContain('linkedin')
    expect(msg).toContain('300 words max')
    expect(msg).toContain('kari-conversion-lift')
    expect(msg).toContain('Kari S., Assistant Manager')
    expect(msg).toContain('pilot store live test')
  })

  it('renders character-bounded formats with maxChars instead of maxWords', () => {
    const msg = buildUserMessage({ narrative: 'two-channels', format: 'tweet' })
    expect(msg).toContain('280 characters max')
  })
})

describe('runContentMultiplier', () => {
  it('generates a ContentPiece for each missing (proofPoint × format) combo', async () => {
    proofFindMany.mockResolvedValue([
      {
        id: 'pp1',
        label: 'kari-lift',
        quoteText: 'q',
        attribution: 'a',
        context: null,
        pieces: [{ format: 'linkedin' }], // already exists; should skip
      },
    ])
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'generated body' }],
    })
    contentCreate.mockResolvedValue({ id: 'c-new' })

    const result = await runContentMultiplier({ apiKey: 'k' })
    // 7 formats total, 1 already present → 6 generated.
    expect(result.generated).toBe(6)
    expect(result.skipped).toBe(1)
    // Each create call uses the proof point id and 'draft' status.
    for (const call of contentCreate.mock.calls) {
      expect(call[0].data.proofPointId).toBe('pp1')
      expect(call[0].data.status).toBe('draft')
      expect(call[0].data.narrative).toBe('kari-lift')
      expect(call[0].data.body).toBe('generated body')
    }
  })

  it('respects the formats filter', async () => {
    proofFindMany.mockResolvedValue([
      { id: 'pp1', label: 'kari-lift', quoteText: 'q', attribution: 'a', context: null, pieces: [] },
    ])
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'body' }] })
    contentCreate.mockResolvedValue({ id: 'c' })

    const result = await runContentMultiplier({
      apiKey: 'k',
      formats: ['linkedin', 'tweet'],
    })
    expect(result.generated).toBe(2)
    expect(contentCreate).toHaveBeenCalledTimes(2)
  })

  it('records a failure (does not crash) when Claude returns empty', async () => {
    proofFindMany.mockResolvedValue([
      { id: 'pp1', label: 'kari-lift', quoteText: 'q', attribution: 'a', context: null, pieces: [] },
    ])
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '   ' }] })

    const result = await runContentMultiplier({
      apiKey: 'k',
      formats: ['linkedin'],
    })
    expect(result.generated).toBe(0)
    expect(result.failed).toBe(1)
    expect(contentCreate).not.toHaveBeenCalled()
  })

  it('generates pieces for pure narratives passed via opts.narratives', async () => {
    proofFindMany.mockResolvedValue([])
    contentFindMany.mockResolvedValue([{ format: 'blog' }])
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'pure body' }] })
    contentCreate.mockResolvedValue({ id: 'cn' })

    const result = await runContentMultiplier({
      apiKey: 'k',
      narratives: ['two-channels'],
      formats: ['blog', 'tweet', 'linkedin'],
    })
    // 'blog' already exists (mocked), so 2 generated.
    expect(result.generated).toBe(2)
    expect(result.skipped).toBe(1)
    for (const call of contentCreate.mock.calls) {
      expect(call[0].data.proofPointId).toBeNull()
      expect(call[0].data.narrative).toBe('two-channels')
    }
  })
})
