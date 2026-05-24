import { describe, it, expect } from 'vitest'
import { _mergeNegativeStyleForTest as mergeNegativeStyle } from './mars.js'

describe('mergeNegativeStyle — stem dedup', () => {
  it('exact-case-insensitive dedup — first-seen wins, additions before existing', () => {
    const out = mergeNegativeStyle('folk guitar, banjo', ['Folk Guitar', 'harmonica'])
    // Additions are added first (preserving their case), then existing terms.
    // "Folk Guitar" wins over the later existing "folk guitar".
    expect(out.split(', ')).toEqual(['Folk Guitar', 'harmonica', 'banjo'])
  })

  it('drops a candidate whose content words are a subset of an accepted phrase', () => {
    // "fingerpicking" (1 content word: "fingerpicking") is fully subsumed by
    // "fingerpicked guitar" — both target the same Suno centroid.
    const out = mergeNegativeStyle('', ['fingerpicked guitar', 'fingerpicking', 'banjo'])
    expect(out.split(', ')).toEqual(['fingerpicked guitar', 'banjo'])
  })

  it('drops a candidate sharing 2+ content words with an accepted phrase', () => {
    // The exact production hiccup we saw on the Riptide seed:
    // "folk-rock electric guitar" and "folk guitar" share content words
    // "folk" and "guitar" — same centroid, keep the first.
    const out = mergeNegativeStyle('', ['folk-rock electric guitar', 'folk guitar', 'banjo'])
    expect(out.split(', ')).toEqual(['folk-rock electric guitar', 'banjo'])
  })

  it('keeps semantically distinct phrases that share only one content word', () => {
    // "acoustic guitar" and "electric piano" share zero content words.
    // "acoustic guitar" and "acoustic drums" share only "acoustic" — different centroids.
    const out = mergeNegativeStyle('', ['acoustic guitar', 'electric piano', 'acoustic drums'])
    expect(out.split(', ')).toEqual(['acoustic guitar', 'electric piano', 'acoustic drums'])
  })

  it('puts anchor additions first so they survive the cap', () => {
    const out = mergeNegativeStyle('always-fire-1, always-fire-2', ['anchor-strategic-1'])
    expect(out.startsWith('anchor-strategic-1')).toBe(true)
  })

  it('passes additions through when existing is empty', () => {
    const out = mergeNegativeStyle('', ['twang', 'banjo'])
    expect(out).toBe('twang, banjo')
  })

  it('returns existing untouched when additions is empty', () => {
    expect(mergeNegativeStyle('foo, bar', [])).toBe('foo, bar')
  })
})
