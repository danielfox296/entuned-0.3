import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    lyricBanEntry: {
      findMany: vi.fn(),
    },
  },
}))

import { loadBanEntries, formatHardBanBlock, OVERUSED_WORDS, AI_CLICHE_PHRASES, AI_CLICHE_SHAPES } from './lyric-craft-rules.js'
import { prisma } from '../../db.js'

const findMany = prisma.lyricBanEntry.findMany as ReturnType<typeof vi.fn>

describe('loadBanEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to hardcoded constants when DB is empty', async () => {
    findMany.mockResolvedValue([])
    const result = await loadBanEntries()
    expect(result.overusedWords).toEqual([...OVERUSED_WORDS])
    expect(result.clichePhrases).toEqual([...AI_CLICHE_PHRASES])
    expect(result.clicheShapes).toEqual([...AI_CLICHE_SHAPES])
  })

  it('returns DB entries grouped by category when present', async () => {
    findMany.mockResolvedValue([
      { category: 'overused_word', text: 'coffee' },
      { category: 'overused_word', text: 'midnight' },
      { category: 'cliche_phrase', text: 'You complete me' },
      { category: 'cliche_shape', text: '"I\'m so [emotion]"' },
    ])
    const result = await loadBanEntries()
    expect(result.overusedWords).toEqual(['coffee', 'midnight'])
    expect(result.clichePhrases).toEqual(['You complete me'])
    expect(result.clicheShapes).toEqual(['"I\'m so [emotion]"'])
  })
})

describe('formatHardBanBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty string when no overused-word entries exist', async () => {
    findMany.mockResolvedValue([
      { category: 'cliche_phrase', text: 'You complete me' },
    ])
    const result = await formatHardBanBlock()
    expect(result).toBe('')
  })

  it('renders strict-language block listing each DB overused-word entry', async () => {
    findMany.mockResolvedValue([
      { category: 'overused_word', text: 'coffee' },
      { category: 'overused_word', text: 'midnight' },
    ])
    const result = await formatHardBanBlock()
    expect(result).toContain('FORBIDDEN WORDS')
    expect(result).toContain('hard constraint')
    expect(result).toContain('coffee')
    expect(result).toContain('midnight')
    expect(result).toMatch(/morphological form|plural|conjugation/i)
  })

  it('uses hardcoded fallback list when DB is empty', async () => {
    findMany.mockResolvedValue([])
    const result = await formatHardBanBlock()
    expect(result).toContain('FORBIDDEN WORDS')
    // Sample a couple of hardcoded entries
    expect(result).toContain(OVERUSED_WORDS[0])
    expect(result).toContain(OVERUSED_WORDS[OVERUSED_WORDS.length - 1])
  })
})
