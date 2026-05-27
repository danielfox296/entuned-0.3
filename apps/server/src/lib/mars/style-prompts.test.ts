// Cold-start + lossless-migration tests for the DB-backed style anchor
// system prompt. Mirrors the Bernie getOrSeedDraftPrompt pattern in
// ../bernie/_helpers.test.ts. Verifies:
//   - existing row in DB → returned, no create
//   - empty table → v1 seeded from the TS const, no version drift
//   - the TS seed const is non-empty (catches accidental empty-string seed)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    styleAnchorPrompt: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import {
  getOrSeedAnchorPrompt,
  STYLE_ANCHOR_SYSTEM_PROMPT_SEED,
} from './style-anchor.js'
import { prisma } from '../../db.js'

describe('getOrSeedAnchorPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns existing row without calling create', async () => {
    ;(prisma.styleAnchorPrompt.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 3,
      promptText: 'operator-edited anchor prompt',
    })

    const result = await getOrSeedAnchorPrompt()

    expect(result).toEqual({ version: 3, promptText: 'operator-edited anchor prompt' })
    expect(prisma.styleAnchorPrompt.findFirst).toHaveBeenCalledWith({ orderBy: { version: 'desc' } })
    expect(prisma.styleAnchorPrompt.create).not.toHaveBeenCalled()
  })

  it('seeds v1 with the TS const when findFirst returns null', async () => {
    ;(prisma.styleAnchorPrompt.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prisma.styleAnchorPrompt.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 1,
      promptText: STYLE_ANCHOR_SYSTEM_PROMPT_SEED,
    })

    const result = await getOrSeedAnchorPrompt()

    expect(prisma.styleAnchorPrompt.create).toHaveBeenCalledWith({
      data: {
        version: 1,
        promptText: STYLE_ANCHOR_SYSTEM_PROMPT_SEED,
        notes: expect.stringContaining('Auto-seeded v1'),
      },
    })
    expect(result).toEqual({ version: 1, promptText: STYLE_ANCHOR_SYSTEM_PROMPT_SEED })
  })

  it('STYLE_ANCHOR_SYSTEM_PROMPT_SEED is non-empty and has the affect-ban rule', () => {
    expect(STYLE_ANCHOR_SYSTEM_PROMPT_SEED.length).toBeGreaterThan(500)
    // Anchor v2 invariants — anything that runs against this prompt depends
    // on them. If you intentionally rewrite the prompt, update these strings.
    expect(STYLE_ANCHOR_SYSTEM_PROMPT_SEED).toContain('SUNO-READABLE LANGUAGE ONLY')
    expect(STYLE_ANCHOR_SYSTEM_PROMPT_SEED).toContain('DEDUP BY STEM')
    expect(STYLE_ANCHOR_SYSTEM_PROMPT_SEED).toContain('NO AFFECT')
  })
})
