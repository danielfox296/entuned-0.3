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

  it('returns empty string only when every category is empty', async () => {
    // Empty DB triggers loadBanEntries() fallback to hardcoded constants, which
    // are non-empty — so the only way to get empty output is a DB with rows
    // but none in any of the three known categories. Mock that explicitly.
    findMany.mockResolvedValue([
      { category: 'unknown_category', text: 'ignored' },
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
    expect(result).toContain('FORBIDDEN')
    expect(result).toContain('hard constraint')
    expect(result).toContain('Forbidden words')
    expect(result).toContain('coffee')
    expect(result).toContain('midnight')
    expect(result).toMatch(/morphological form|plural|conjugation/i)
  })

  it('renders cliché-phrase entries under FORBIDDEN framing', async () => {
    findMany.mockResolvedValue([
      { category: 'cliche_phrase', text: 'porch light' },
      { category: 'cliche_phrase', text: 'my skin' },
    ])
    const result = await formatHardBanBlock()
    expect(result).toContain('FORBIDDEN')
    expect(result).toContain('hard constraint')
    expect(result).toContain('Forbidden phrases')
    expect(result).toContain('porch light')
    expect(result).toContain('my skin')
  })

  it('renders cliché-shape entries under FORBIDDEN framing', async () => {
    findMany.mockResolvedValue([
      { category: 'cliche_shape', text: '"I\'m so [emotion] without you"' },
      { category: 'cliche_shape', text: '"My heart is [adjective]"' },
    ])
    const result = await formatHardBanBlock()
    expect(result).toContain('FORBIDDEN')
    expect(result).toContain('hard constraint')
    expect(result).toContain('Forbidden shapes')
    expect(result).toContain('[emotion] without you')
    expect(result).toContain('My heart is [adjective]')
  })

  it('combines all three categories in a single block when all are present', async () => {
    findMany.mockResolvedValue([
      { category: 'overused_word', text: 'collar' },
      { category: 'cliche_phrase', text: 'porch light' },
      { category: 'cliche_shape', text: '"I\'m so [emotion]"' },
    ])
    const result = await formatHardBanBlock()
    expect(result).toContain('Forbidden words')
    expect(result).toContain('collar')
    expect(result).toContain('Forbidden phrases')
    expect(result).toContain('porch light')
    expect(result).toContain('Forbidden shapes')
    expect(result).toContain('[emotion]')
  })

  it('uses hardcoded fallback list when DB is empty', async () => {
    findMany.mockResolvedValue([])
    const result = await formatHardBanBlock()
    expect(result).toContain('FORBIDDEN')
    // Sample entries from each hardcoded category
    expect(result).toContain(OVERUSED_WORDS[0])
    expect(result).toContain(OVERUSED_WORDS[OVERUSED_WORDS.length - 1])
    expect(result).toContain(AI_CLICHE_PHRASES[0])
    expect(result).toContain(AI_CLICHE_SHAPES[0])
  })
})
