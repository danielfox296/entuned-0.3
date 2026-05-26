import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    genreGravityRule: { findMany: vi.fn() },
  },
}))

import { injectHarmonicPalette } from './harmonic-palette.js'
import { prisma } from '../../db.js'

const findMany = prisma.genreGravityRule.findMany as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('injectHarmonicPalette', () => {
  it('no-ops when no rules exist', async () => {
    findMany.mockResolvedValue([])
    const r = await injectHarmonicPalette('2010s electropop, deadpan delivery', null)
    expect(r.style).toBe('2010s electropop, deadpan delivery')
    expect(r.palette).toBeNull()
    expect(r.matchedTag).toBeNull()
  })

  it('no-ops when no rule tag matches the anchor or style', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'] },
      { tag: 'jazz', positivePalettes: ['ii-V-I'] },
    ])
    const r = await injectHarmonicPalette('2010s electropop, deadpan delivery', '2010s electropop')
    expect(r.palette).toBeNull()
    expect(r.style).toBe('2010s electropop, deadpan delivery')
  })

  it('matches against the anchor tag (case-insensitive)', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'] },
    ])
    const r = await injectHarmonicPalette('2000s outlaw country, baritone', '2000s outlaw country')
    expect(r.matchedTag).toBe('country')
    expect(r.palette).toBe('I-IV vamp')
    expect(r.style).toBe('2000s outlaw country, baritone, I-IV vamp')
  })

  it('matches against the style string when anchor is null', async () => {
    findMany.mockResolvedValue([
      { tag: 'jazz', positivePalettes: ['iii-vi-ii-V-I cycle'] },
    ])
    const r = await injectHarmonicPalette('2010s jazz-funk, Rhodes lead', null)
    expect(r.matchedTag).toBe('jazz')
    expect(r.palette).toBe('iii-vi-ii-V-I cycle')
  })

  it('case-insensitively matches mixed casing', async () => {
    findMany.mockResolvedValue([
      { tag: 'Country', positivePalettes: ['I-IV vamp'] },
    ])
    const r = await injectHarmonicPalette('2010s COUNTRY ballad', 'Country')
    expect(r.matchedTag).toBe('Country')
    expect(r.palette).toBe('I-IV vamp')
  })

  it('picks one palette at random when multiple are configured', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp', 'I-V pendulum', 'I-IV-V three-chord'] },
    ])
    // Force deterministic pick via Math.random stub
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5) // picks index 1
    const r = await injectHarmonicPalette('country song', 'country')
    expect(r.palette).toBe('I-V pendulum')
    spy.mockRestore()
  })

  it('only loads rules that have non-empty positivePalettes', async () => {
    findMany.mockResolvedValue([])
    await injectHarmonicPalette('any style', null)
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, positivePalettes: { isEmpty: false } },
      select: { tag: true, positivePalettes: true },
    })
  })

  it('returns the first matching rule when multiple tags could match', async () => {
    findMany.mockResolvedValue([
      { tag: 'soul', positivePalettes: ['ii-V-I extended'] },
      { tag: 'jazz', positivePalettes: ['modal vamp'] },
    ])
    // Both tags appear in the input — first wins (DB order)
    const r = await injectHarmonicPalette('2010s soul-jazz fusion', 'soul-jazz')
    expect(r.matchedTag).toBe('soul')
    expect(r.palette).toBe('ii-V-I extended')
  })
})
