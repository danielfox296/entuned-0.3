import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    genreGravityRule: { findMany: vi.fn() },
  },
}))

import { injectHarmonicPalette } from './harmonic-palette.js'
import { prisma } from '../../db.js'

const findMany = prisma.genreGravityRule.findMany as ReturnType<typeof vi.fn>

const EMPTY_TRIPLE = { vocalCharacters: [], vocalDeliveries: [], vocalEffects: [] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('injectHarmonicPalette', () => {
  it('no-ops when no rules exist', async () => {
    findMany.mockResolvedValue([])
    const r = await injectHarmonicPalette('2010s electropop, deadpan delivery', null)
    expect(r.style).toBe('2010s electropop, deadpan delivery')
    expect(r.palette).toBeNull()
    expect(r.vocalIdentity).toBeNull()
    expect(r.vocalDescriptor).toBeNull()
    expect(r.matchedTag).toBeNull()
  })

  it('no-ops when no rule tag matches the anchor or style', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'], vocalDescriptors: [], ...EMPTY_TRIPLE },
      { tag: 'jazz', positivePalettes: ['ii-V-I'], vocalDescriptors: [], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2010s electropop, deadpan delivery', '2010s electropop')
    expect(r.palette).toBeNull()
    expect(r.vocalIdentity).toBeNull()
    expect(r.vocalDescriptor).toBeNull()
    expect(r.style).toBe('2010s electropop, deadpan delivery')
  })

  it('matches against the anchor tag (case-insensitive)', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'], vocalDescriptors: [], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2000s outlaw country, baritone', '2000s outlaw country')
    expect(r.matchedTag).toBe('country')
    expect(r.palette).toBe('I-IV vamp')
    expect(r.style).toBe('2000s outlaw country, baritone, I-IV vamp')
  })

  it('matches against the style string when anchor is null', async () => {
    findMany.mockResolvedValue([
      { tag: 'jazz', positivePalettes: ['iii-vi-ii-V-I cycle'], vocalDescriptors: [], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2010s jazz-funk, Rhodes lead', null)
    expect(r.matchedTag).toBe('jazz')
    expect(r.palette).toBe('iii-vi-ii-V-I cycle')
  })

  it('case-insensitively matches mixed casing', async () => {
    findMany.mockResolvedValue([
      { tag: 'Country', positivePalettes: ['I-IV vamp'], vocalDescriptors: [], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2010s COUNTRY ballad', 'Country')
    expect(r.matchedTag).toBe('Country')
    expect(r.palette).toBe('I-IV vamp')
  })

  it('picks one palette at random when multiple are configured', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp', 'I-V pendulum', 'I-IV-V three-chord'], vocalDescriptors: [], ...EMPTY_TRIPLE },
    ])
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5) // picks index 1
    const r = await injectHarmonicPalette('country song', 'country')
    expect(r.palette).toBe('I-V pendulum')
    spy.mockRestore()
  })

  it('loads rules where any vocal or palette array is non-empty', async () => {
    findMany.mockResolvedValue([])
    await injectHarmonicPalette('any style', null)
    expect(findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        OR: [
          { positivePalettes: { isEmpty: false } },
          { vocalDescriptors: { isEmpty: false } },
          { vocalCharacters: { isEmpty: false } },
          { vocalDeliveries: { isEmpty: false } },
          { vocalEffects: { isEmpty: false } },
        ],
      },
      select: {
        tag: true, positivePalettes: true, vocalDescriptors: true,
        vocalCharacters: true, vocalDeliveries: true, vocalEffects: true,
      },
    })
  })

  it('returns the first matching rule when multiple tags could match', async () => {
    findMany.mockResolvedValue([
      { tag: 'soul', positivePalettes: ['ii-V-I extended'], vocalDescriptors: [], ...EMPTY_TRIPLE },
      { tag: 'jazz', positivePalettes: ['modal vamp'], vocalDescriptors: [], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2010s soul-jazz fusion', 'soul-jazz')
    expect(r.matchedTag).toBe('soul')
    expect(r.palette).toBe('ii-V-I extended')
  })

  // --- Legacy vocalDescriptors (backward compat) ---

  it('falls back to legacy vocalDescriptors when triple-stack arrays are empty', async () => {
    findMany.mockResolvedValue([
      { tag: 'country', positivePalettes: ['I-IV vamp'], vocalDescriptors: ['drawl'], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2000s outlaw country', 'country')
    expect(r.palette).toBe('I-IV vamp')
    expect(r.vocalDescriptor).toBe('drawl')
    expect(r.vocalIdentity).toBeNull()
    // Palette appended to style, but legacy vocal descriptor is NOT appended
    // (it used to be — now it's returned separately for the caller to place)
    expect(r.style).toBe('2000s outlaw country, I-IV vamp')
  })

  it('returns only legacy vocal descriptor when rule has descriptors but no palettes', async () => {
    findMany.mockResolvedValue([
      { tag: 'folk', positivePalettes: [], vocalDescriptors: ['breathy intimate'], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2010s indie folk', 'folk')
    expect(r.palette).toBeNull()
    expect(r.vocalDescriptor).toBe('breathy intimate')
    expect(r.vocalIdentity).toBeNull()
    expect(r.style).toBe('2010s indie folk')
  })

  it('appends only palette when rule has palettes but no descriptors', async () => {
    findMany.mockResolvedValue([
      { tag: 'jazz', positivePalettes: ['modal tonic vamp'], vocalDescriptors: [], ...EMPTY_TRIPLE },
    ])
    const r = await injectHarmonicPalette('2010s jazz-funk', 'jazz')
    expect(r.palette).toBe('modal tonic vamp')
    expect(r.vocalDescriptor).toBeNull()
    expect(r.vocalIdentity).toBeNull()
    expect(r.style).toBe('2010s jazz-funk, modal tonic vamp')
  })

  // --- Triple-stack vocal identity ---

  it('composes triple-stack vocal identity from all three arrays', async () => {
    findMany.mockResolvedValue([{
      tag: 'country',
      positivePalettes: ['I-IV vamp'],
      vocalDescriptors: ['drawl'],
      vocalCharacters: ['raspy', 'gritty'],
      vocalDeliveries: ['conversational', 'behind-the-beat'],
      vocalEffects: ['dry studio', 'close-mic'],
    }])
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0) // always picks index 0
    const r = await injectHarmonicPalette('2000s outlaw country', 'country')
    expect(r.vocalIdentity).toBe('raspy vocal, conversational delivery, dry studio recording')
    expect(r.vocalDescriptor).toBeNull() // triple-stack takes precedence
    expect(r.palette).toBe('I-IV vamp')
    expect(r.style).toBe('2000s outlaw country, I-IV vamp')
    spy.mockRestore()
  })

  it('composes partial triple-stack when only some arrays are populated', async () => {
    findMany.mockResolvedValue([{
      tag: 'jazz',
      positivePalettes: [],
      vocalDescriptors: [],
      vocalCharacters: ['smooth'],
      vocalDeliveries: [],
      vocalEffects: ['reverb-drenched'],
    }])
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await injectHarmonicPalette('2010s jazz', 'jazz')
    expect(r.vocalIdentity).toBe('smooth vocal, reverb-drenched recording')
    expect(r.vocalDescriptor).toBeNull()
    spy.mockRestore()
  })

  it('triple-stack takes precedence over legacy vocalDescriptors', async () => {
    findMany.mockResolvedValue([{
      tag: 'soul',
      positivePalettes: [],
      vocalDescriptors: ['legacy-descriptor'],
      vocalCharacters: ['silky'],
      vocalDeliveries: ['intimate'],
      vocalEffects: ['close-mic'],
    }])
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await injectHarmonicPalette('2010s soul', 'soul')
    expect(r.vocalIdentity).toBe('silky vocal, intimate delivery, close-mic recording')
    expect(r.vocalDescriptor).toBeNull() // legacy NOT used when triple-stack present
    spy.mockRestore()
  })
})
