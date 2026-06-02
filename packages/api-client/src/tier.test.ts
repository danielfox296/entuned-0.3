import { describe, it, expect } from 'vitest'
import {
  TIER_RANK,
  TIER_LABEL,
  TIER_PRICE,
  labelForTier,
  highestTier,
  type Tier,
} from './tier.js'

describe('TIER_LABEL', () => {
  it('maps each tier value to its current public-facing label', () => {
    expect(TIER_LABEL).toEqual({
      free: 'Entuned Free',
      mvp_pilot: 'MVP Pilot',
      core: 'Boost',
      pro: 'Pro',
      enterprise: 'Enterprise',
    })
  })

  it('never uses the retired "Essentials" or "Core" labels', () => {
    const labels = Object.values(TIER_LABEL)
    expect(labels).not.toContain('Essentials')
    expect(labels).not.toContain('Core')
  })
})

describe('TIER_RANK', () => {
  it('orders free < mvp_pilot < core < pro < enterprise', () => {
    expect(TIER_RANK.free).toBeLessThan(TIER_RANK.mvp_pilot)
    expect(TIER_RANK.mvp_pilot).toBeLessThan(TIER_RANK.core)
    expect(TIER_RANK.core).toBeLessThan(TIER_RANK.pro)
    expect(TIER_RANK.pro).toBeLessThan(TIER_RANK.enterprise)
  })

  it('preserves the customer-facing integer ranks (free/core/pro/enterprise)', () => {
    expect(TIER_RANK.free).toBe(0)
    expect(TIER_RANK.core).toBe(1)
    expect(TIER_RANK.pro).toBe(2)
    expect(TIER_RANK.enterprise).toBe(3)
  })
})

describe('TIER_PRICE', () => {
  it('keeps the current price lines per tier', () => {
    expect(TIER_PRICE).toEqual({
      free: 'Free',
      mvp_pilot: 'Custom',
      core: '$99 / location / month',
      pro: '$399 / location / month',
      enterprise: 'Custom',
    })
  })
})

describe('labelForTier', () => {
  it('returns the canonical label for a known tier', () => {
    expect(labelForTier('free')).toBe('Entuned Free')
    expect(labelForTier('core')).toBe('Boost')
    expect(labelForTier('pro')).toBe('Pro')
    expect(labelForTier('enterprise')).toBe('Enterprise')
    expect(labelForTier('mvp_pilot')).toBe('MVP Pilot')
  })

  it('echoes an unknown tier string unchanged (mirrors TIER_LABEL[x] ?? x)', () => {
    expect(labelForTier('something_else')).toBe('something_else')
    expect(labelForTier('')).toBe('')
  })
})

describe('highestTier', () => {
  it('returns free for an empty store list', () => {
    expect(highestTier([])).toBe('free')
  })

  it('returns the single store tier for one store', () => {
    expect(highestTier([{ tier: 'core' }])).toBe('core')
  })

  it('picks the highest-rank tier across multiple stores', () => {
    const stores: { tier: Tier }[] = [{ tier: 'free' }, { tier: 'pro' }, { tier: 'core' }]
    expect(highestTier(stores)).toBe('pro')
  })

  it('treats a paid store as outranking a leftover free store', () => {
    expect(highestTier([{ tier: 'core' }, { tier: 'free' }])).toBe('core')
  })

  it('ranks enterprise above pro', () => {
    expect(highestTier([{ tier: 'pro' }, { tier: 'enterprise' }])).toBe('enterprise')
  })
})
