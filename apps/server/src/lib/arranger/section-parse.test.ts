import { describe, it, expect } from 'vitest'
import {
  normalizeSection,
  planChoruses,
  lastSectionKey,
  parseLyricSections,
} from './section-parse.js'

const VCVC = `[Verse 1]
I walked out
the door stayed open

[Chorus]
hold the line
hold the line tonight

[Verse 2]
came back late

[Chorus]
hold the line
hold the line tonight`

describe('normalizeSection', () => {
  it('maps canonical labels to keys', () => {
    expect(normalizeSection('Verse 1')?.key).toBe('verse')
    expect(normalizeSection('Chorus')?.key).toBe('chorus')
    expect(normalizeSection('Bridge')?.key).toBe('bridge')
    expect(normalizeSection('Outro')?.key).toBe('outro')
    expect(normalizeSection('Intro')?.key).toBe('intro')
  })

  it('orders pre-chorus and final-chorus before chorus', () => {
    expect(normalizeSection('Pre-Chorus')?.key).toBe('pre_chorus')
    expect(normalizeSection('Pre Chorus')?.key).toBe('pre_chorus')
    const fc = normalizeSection('Final Chorus')
    expect(fc?.key).toBe('chorus')
    expect(fc?.explicitFinal).toBe(true)
  })

  it('returns null for unrecognized labels', () => {
    expect(normalizeSection('Hook')).toBeNull()
    expect(normalizeSection('Interlude')).toBeNull()
    expect(normalizeSection('Break')).toBeNull()
  })
})

describe('planChoruses', () => {
  it('counts choruses and detects explicit finals', () => {
    expect(planChoruses(VCVC)).toEqual({ totalChoruses: 2, hasExplicitFinal: false })
    const withFinal = VCVC.replace(/\[Chorus\]\nhold the line\nhold the line tonight$/, '[Final Chorus]\nhold the line\nhold the line tonight')
    expect(planChoruses(withFinal).hasExplicitFinal).toBe(true)
  })
})

describe('lastSectionKey', () => {
  it('returns the key of the final header', () => {
    expect(lastSectionKey(VCVC)).toBe('chorus')
    expect(lastSectionKey(VCVC + '\n\n[Outro]')).toBe('outro')
  })

  it('returns "unrecognized" when the last header is not canonical', () => {
    expect(lastSectionKey(VCVC + '\n\n[Tag]')).toBe('unrecognized')
  })

  it('returns null when there are no headers', () => {
    expect(lastSectionKey('just some lines\nno headers')).toBeNull()
  })
})

describe('parseLyricSections', () => {
  it('parses ordered blocks with verbatim lines', () => {
    const blocks = parseLyricSections(VCVC)
    expect(blocks.map((b) => b.headerRaw)).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus'])
    expect(blocks.map((b) => b.key)).toEqual(['verse', 'chorus', 'verse', 'chorus'])
    expect(blocks[0].lines).toEqual(['I walked out', 'the door stayed open'])
    expect(blocks[1].lines).toEqual(['hold the line', 'hold the line tonight'])
  })

  it('preserves lyric lines byte-for-byte (hook integrity)', () => {
    const blocks = parseLyricSections(VCVC)
    const allLines = blocks.flatMap((b) => b.lines)
    expect(allLines).toEqual([
      'I walked out',
      'the door stayed open',
      'hold the line',
      'hold the line tonight',
      'came back late',
      'hold the line',
      'hold the line tonight',
    ])
  })

  it('ranks the last of >=2 inferred choruses as final', () => {
    const blocks = parseLyricSections(VCVC)
    const choruses = blocks.filter((b) => b.key === 'chorus')
    expect(choruses[0].chorusRank).toEqual({ index: 1, isFinal: false })
    expect(choruses[1].chorusRank).toEqual({ index: 2, isFinal: true })
  })

  it('does not mark a lone chorus as final', () => {
    const single = `[Verse 1]
one line

[Chorus]
the hook`
    const blocks = parseLyricSections(single)
    expect(blocks.find((b) => b.key === 'chorus')?.chorusRank).toEqual({ index: 1, isFinal: false })
  })

  it('honors an explicit Final Chorus even when it is not last', () => {
    const explicit = `[Verse 1]
a

[Final Chorus]
the hook

[Outro]
fade`
    const blocks = parseLyricSections(explicit)
    expect(blocks.find((b) => b.explicitFinal)?.chorusRank).toEqual({ index: 1, isFinal: true })
  })

  it('keeps unrecognized headers as blocks with null key and their lines', () => {
    const withHook = `[Verse 1]
a line

[Hook]
the catchy part`
    const blocks = parseLyricSections(withHook)
    expect(blocks[1].headerRaw).toBe('Hook')
    expect(blocks[1].key).toBeNull()
    expect(blocks[1].lines).toEqual(['the catchy part'])
  })

  it('drops blank lines and pre-header preamble', () => {
    const messy = `some preamble before any header

[Verse 1]

a line


another line`
    const blocks = parseLyricSections(messy)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lines).toEqual(['a line', 'another line'])
  })
})
