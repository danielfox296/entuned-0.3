import { describe, it, expect } from 'vitest'
import {
  sanitizeAttribution,
  attributionIsEmpty,
  formatAttributionSummary,
  EMPTY_ATTRIBUTION,
} from './attribution.js'

describe('sanitizeAttribution', () => {
  it('keeps valid fields, trims them, and drops unknown keys', () => {
    const out = sanitizeAttribution({
      referrer: '  https://reddit.com/r/x  ',
      landingPath: '/pricing?utm_source=reddit',
      utmSource: 'reddit',
      utmMedium: 'social',
      utmCampaign: 'spring',
      utmTerm: 'shoes',
      utmContent: 'hero',
      garbage: 'ignored',
    } as Record<string, unknown>)
    expect(out).toEqual({
      referrer: 'https://reddit.com/r/x',
      landingPath: '/pricing?utm_source=reddit',
      utmSource: 'reddit',
      utmMedium: 'social',
      utmCampaign: 'spring',
      utmTerm: 'shoes',
      utmContent: 'hero',
    })
  })

  it('coerces empty / whitespace / non-string fields to null', () => {
    const out = sanitizeAttribution({
      referrer: '',
      landingPath: '   ',
      utmSource: 123,
      utmMedium: null,
      utmCampaign: undefined,
    } as Record<string, unknown>)
    expect(out).toEqual(EMPTY_ATTRIBUTION)
  })

  it('returns EMPTY_ATTRIBUTION for non-object input', () => {
    expect(sanitizeAttribution(undefined)).toEqual(EMPTY_ATTRIBUTION)
    expect(sanitizeAttribution(null)).toEqual(EMPTY_ATTRIBUTION)
    expect(sanitizeAttribution('string')).toEqual(EMPTY_ATTRIBUTION)
    expect(sanitizeAttribution(['a'])).toEqual(EMPTY_ATTRIBUTION)
  })

  it('clamps overlong values', () => {
    const longUrl = 'https://x.com/' + 'a'.repeat(2000)
    const longUtm = 'b'.repeat(500)
    const out = sanitizeAttribution({ referrer: longUrl, utmSource: longUtm })
    expect(out.referrer!.length).toBe(1024)
    expect(out.utmSource!.length).toBe(256)
  })
})

describe('attributionIsEmpty', () => {
  it('is true for the empty attribution and false when any field is set', () => {
    expect(attributionIsEmpty(EMPTY_ATTRIBUTION)).toBe(true)
    expect(attributionIsEmpty({ ...EMPTY_ATTRIBUTION, utmSource: 'reddit' })).toBe(false)
  })
})

describe('formatAttributionSummary', () => {
  it('combines utm, referrer host, and landing path', () => {
    const s = formatAttributionSummary({
      referrer: 'https://www.reddit.com/r/smallbusiness',
      landingPath: '/for-apparel',
      utmSource: 'reddit',
      utmMedium: 'social',
      utmCampaign: 'spring-launch',
      utmTerm: null,
      utmContent: null,
    })
    expect(s).toBe('utm: reddit / social / spring-launch · via www.reddit.com · landed /for-apparel')
  })

  it('reduces a referrer URL to its host', () => {
    const s = formatAttributionSummary({ ...EMPTY_ATTRIBUTION, referrer: 'https://google.com/search?q=x' })
    expect(s).toBe('via google.com')
  })

  it('falls back to "Direct / unknown" when nothing is captured', () => {
    expect(formatAttributionSummary(EMPTY_ATTRIBUTION)).toBe('Direct / unknown')
  })
})
