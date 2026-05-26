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
    expect(r.vocalDescriptor).toBeNull()
    expect(r.matchedTag).toBeNull()
  })

  it('no-ops when no rule tag matches the anchor or style', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'], vocalDescriptors: [] },
      { tag: 'jazz', positivePalettes: ['ii-V-I'], vocalDescriptors: [] },
    ])
    const r = await injectHarmonicPalette('2010s electropop, deadpan delivery', '2010s electropop')
    expect(r.palette).toBeNull()
    expect(r.vocalDescriptor).toBeNull()
    expect(r.style).toBe('2010s electropop, deadpan delivery')
  })

  it('matches against the anchor tag (case-insensitive)', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'], vocalDescriptors: [] },
    ])
    const r = await injectHarmonicPalette('2000s outlaw country, baritone', '2000s outlaw country')
    expect(r.matchedTag).toBe('country')
    expect(r.palette).toBe('I-IV vamp')
    expect(r.style).toBe('2000s outlaw country, baritone, I-IV vamp')
  })

  it('matches against the style string when anchor is null', async () => {
    findMany.mockResolvedValue([
      { tag: 'jazz', positivePalettes: ['iii-vi-ii-V-I cycle'], vocalDescriptors: [] },
    ])
    const r = await injectHarmonicPalette('2010s jazz-funk, Rhodes lead', null)
    expect(r.matchedTag).toBe('jazz')
    expect(r.palette).toBe('iii-vi-ii-V-I cycle')
  })

  it('case-insensitively matches mixed casing', async () => {
    findMany.mockResolvedValue([
      { tag: 'Country', positivePalettes: ['I-IV vamp'], vocalDescriptors: [] },
    ])
    const r = await injectHarmonicPalette('2010s COUNTRY ballad', 'Country')
    expect(r.matchedTag).toBe('Country')
    expect(r.palette).toBe('I-IV vamp')
  })

  it('picks one palette at random when multiple are configured', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp', 'I-V pendulum', 'I-IV-V three-chord'], vocalDescriptors: [] },
    ])
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5) // picks index 1
    const r = await injectHarmonicPalette('country song', 'country')
    expect(r.palette).toBe('I-V pendulum')
    spy.mockRestore()
  })

  it('loads rules where EITHER positivePalettes OR vocalDescriptors is non-empty', async () => {
    findMany.mockResolvedValue([])
    await injectHarmonicPalette('any style', null)
    expect(findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        OR: [
          { positivePalettes: { isEmpty: false } },
          { vocalDescriptors: { isEmpty: false } },
        ],
      },
      select: { tag: true, positivePalettes: true, vocalDescriptors: true },
    })
  })

  it('returns the first matching rule when multiple tags could match', async () => {
    findMany.mockResolvedValue([
      { tag: 'soul', positivePalettes: ['ii-V-I extended'], vocalDescriptors: [] },
      { tag: 'jazz', positivePalettes: ['modal vamp'], vocalDescriptors: [] },
    ])
    const r = await injectHarmonicPalette('2010s soul-jazz fusion', 'soul-jazz')
    expect(r.matchedTag).toBe('soul')
    expect(r.palette).toBe('ii-V-I extended')
  })

  it('appends BOTH palette and vocal descriptor when rule has both', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'], vocalDescriptors: ['drawl'] },
    ])
    const r = await injectHarmonicPalette('2000s outlaw country', 'country')
    expect(r.palette).toBe('I-IV vamp')
    expect(r.vocalDescriptor).toBe('drawl')
    expect(r.style).toBe('2000s outlaw country, I-IV vamp, drawl')
  })

  it('appends only vocal descriptor when rule has descriptors but no palettes', async () => {
    findMany.mockResolvedValue([
      { tag: 'folk', positivePalettes: [], vocalDescriptors: ['breathy intimate'] },
    ])
    const r = await injectHarmonicPalette('2010s indie folk', 'folk')
    expect(r.palette).toBeNull()
    expect(r.vocalDescriptor).toBe('breathy intimate')
    expect(r.style).toBe('2010s indie folk, breathy intimate')
  })

  it('appends only palette when rule has palettes but no descriptors', async () => {
    findMany.mockResolvedValue([
      { tag: 'jazz', positivePalettes: ['modal tonic vamp'], vocalDescriptors: [] },
    ])
    const r = await injectHarmonicPalette('2010s jazz-funk', 'jazz')
    expect(r.palette).toBe('modal tonic vamp')
    expect(r.vocalDescriptor).toBeNull()
    expect(r.style).toBe('2010s jazz-funk, modal tonic vamp')
  })
})
