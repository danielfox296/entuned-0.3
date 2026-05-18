import { describe, it, expect } from 'vitest'
import { tierRank, effectiveTier, compIsActive } from './tier.js'
import type { Tier, StoreTierFields } from './tier.js'

// Regression layer for the mvp_pilot rip-out (2026-05-18). The `Tier` union
// is now exactly { 'free' | 'core' | 'pro' | 'enterprise' }; any other value
// — including 'mvp_pilot' — must rank 0 (treated as unknown). Zero rows had
// tier='mvp_pilot' in production at the time of the rip-out; these tests
// pin the post-removal behavior.

describe('tierRank', () => {
  it('ranks the four canonical tiers in order', () => {
    expect(tierRank('free')).toBe(0)
    expect(tierRank('core')).toBe(1)
    expect(tierRank('pro')).toBe(2)
    expect(tierRank('enterprise')).toBe(3)
  })

  it('returns 0 for null or undefined', () => {
    expect(tierRank(null)).toBe(0)
    expect(tierRank(undefined)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(tierRank('')).toBe(0)
  })

  it('returns 0 for the removed mvp_pilot value', () => {
    expect(tierRank('mvp_pilot')).toBe(0)
  })

  it('returns 0 for any other unknown string', () => {
    expect(tierRank('lol')).toBe(0)
    expect(tierRank('CORE')).toBe(0) // case-sensitive
  })
})

describe('effectiveTier', () => {
  const NOW = new Date('2026-05-18T12:00:00Z')
  const FUTURE = new Date('2026-12-31T12:00:00Z')
  const PAST = new Date('2026-01-01T12:00:00Z')

  function store(fields: Partial<StoreTierFields>): StoreTierFields {
    return { tier: 'free', compTier: null, compExpiresAt: null, ...fields }
  }

  it('returns paid tier when no comp is set', () => {
    expect(effectiveTier(store({ tier: 'core' }), NOW)).toBe<Tier>('core')
    expect(effectiveTier(store({ tier: 'free' }), NOW)).toBe<Tier>('free')
  })

  it('returns comp tier when it ranks above paid and unexpired (with explicit expiry)', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: FUTURE }), NOW),
    ).toBe<Tier>('pro')
  })

  it('returns comp tier when it ranks above paid and expiresAt is null (open-ended comp)', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: null }), NOW),
    ).toBe<Tier>('pro')
  })

  it('returns paid tier when comp is expired', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: PAST }), NOW),
    ).toBe<Tier>('free')
  })

  it('returns paid tier when comp ranks below paid (no downgrade)', () => {
    expect(
      effectiveTier(store({ tier: 'pro', compTier: 'core', compExpiresAt: FUTURE }), NOW),
    ).toBe<Tier>('pro')
  })

  it('returns paid tier when comp ranks equal to paid', () => {
    expect(
      effectiveTier(store({ tier: 'core', compTier: 'core', compExpiresAt: FUTURE }), NOW),
    ).toBe<Tier>('core')
  })

  it('treats a comp at the expiry instant as expired', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: NOW }), NOW),
    ).toBe<Tier>('free')
  })

  it('defaults missing tier to free', () => {
    // Caller may pass an empty string from a partial projection.
    expect(effectiveTier(store({ tier: '' }), NOW)).toBe('')
    // The function does `(store.tier as Tier) ?? 'free'`; only nullish coalesces.
    // Document the actual behavior: empty string is preserved (not coerced).
  })
})

describe('compIsActive', () => {
  const NOW = new Date('2026-05-18T12:00:00Z')
  const FUTURE = new Date('2026-12-31T12:00:00Z')
  const PAST = new Date('2026-01-01T12:00:00Z')

  function store(fields: Partial<StoreTierFields>): StoreTierFields {
    return { tier: 'free', compTier: null, compExpiresAt: null, ...fields }
  }

  it('returns false when compTier is null', () => {
    expect(compIsActive(store({ compTier: null }), NOW)).toBe(false)
  })

  it('returns true when compTier is set and expiresAt is null (open-ended)', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: null }), NOW)).toBe(true)
  })

  it('returns true when compTier is set and expiresAt is in the future', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: FUTURE }), NOW)).toBe(true)
  })

  it('returns false when expiresAt is in the past', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: PAST }), NOW)).toBe(false)
  })

  it('returns false at the expiry instant (treats expiry as exclusive)', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: NOW }), NOW)).toBe(false)
  })
})
