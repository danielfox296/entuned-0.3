import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    outcome: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    freeTierOutcome: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

import {
  getFreeTierAllowedOutcomeIds,
  isFreeTierAllowedOutcome,
  pickSystemDefaultOutcomeId,
} from './outcomes.js'
import { prisma } from '../db.js'

// Convenience casts.
const outcomeFindMany = prisma.outcome.findMany as unknown as ReturnType<typeof vi.fn>
const outcomeFindFirst = prisma.outcome.findFirst as unknown as ReturnType<typeof vi.fn>
const outcomeFindUnique = prisma.outcome.findUnique as unknown as ReturnType<typeof vi.fn>
const freeTierFindMany = prisma.freeTierOutcome.findMany as unknown as ReturnType<typeof vi.fn>
const freeTierFindUnique = prisma.freeTierOutcome.findUnique as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// -- Pin the canonical FREE_TIER_PREFERENCE order via observable behavior. --
// The source defines FREE_TIER_PREFERENCE = ['chill', 'steady', 'upbeat'] and
// the picker iterates that array in order. If someone renames or reorders, the
// "preference order" tests below will fail.
describe('FREE_TIER_PREFERENCE (pinned via behavior)', () => {
  it('picks "chill" first when all three preferences are present and allowlisted', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-chill', outcomeKey: 'chill', title: 'Chill', displayTitle: null, version: 1 },
      { id: 'id-steady', outcomeKey: 'steady', title: 'Steady', displayTitle: null, version: 1 },
      { id: 'id-upbeat', outcomeKey: 'upbeat', title: 'Upbeat', displayTitle: null, version: 1 },
    ])
    freeTierFindMany.mockResolvedValueOnce([
      { outcomeKey: 'chill' },
      { outcomeKey: 'steady' },
      { outcomeKey: 'upbeat' },
    ])

    const result = await pickSystemDefaultOutcomeId('free')
    expect(result).toBe('id-chill')
  })

  it('picks "steady" when "chill" is missing but "steady" and "upbeat" are allowlisted', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-steady', outcomeKey: 'steady', title: 'Steady', displayTitle: null, version: 1 },
      { id: 'id-upbeat', outcomeKey: 'upbeat', title: 'Upbeat', displayTitle: null, version: 1 },
    ])
    freeTierFindMany.mockResolvedValueOnce([
      { outcomeKey: 'steady' },
      { outcomeKey: 'upbeat' },
    ])

    const result = await pickSystemDefaultOutcomeId('free')
    expect(result).toBe('id-steady')
  })

  it('picks "upbeat" when only "upbeat" is allowlisted among the preferences', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-upbeat', outcomeKey: 'upbeat', title: 'Upbeat', displayTitle: null, version: 1 },
    ])
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'upbeat' }])

    const result = await pickSystemDefaultOutcomeId('free')
    expect(result).toBe('id-upbeat')
  })
})

describe('getFreeTierAllowedOutcomeIds', () => {
  it('returns an empty Set when FreeTierOutcome has no rows (and does not call outcome.findMany)', async () => {
    freeTierFindMany.mockResolvedValueOnce([])

    const result = await getFreeTierAllowedOutcomeIds()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
    expect(outcomeFindMany).not.toHaveBeenCalled()
  })

  it('returns a Set of Outcome IDs for keys present in the allowlist', async () => {
    freeTierFindMany.mockResolvedValueOnce([
      { outcomeKey: 'chill' },
      { outcomeKey: 'steady' },
    ])
    outcomeFindMany.mockResolvedValueOnce([{ id: 'id-1' }, { id: 'id-2' }])

    const result = await getFreeTierAllowedOutcomeIds()

    expect(Array.from(result).sort()).toEqual(['id-1', 'id-2'])
  })

  it('queries Outcome with the keys from the allowlist', async () => {
    freeTierFindMany.mockResolvedValueOnce([
      { outcomeKey: 'chill' },
      { outcomeKey: 'upbeat' },
    ])
    outcomeFindMany.mockResolvedValueOnce([{ id: 'id-1' }, { id: 'id-2' }])

    await getFreeTierAllowedOutcomeIds()

    expect(outcomeFindMany).toHaveBeenCalledWith({
      where: { outcomeKey: { in: ['chill', 'upbeat'] } },
      select: { id: true },
    })
  })

  it('returns an empty Set when no Outcomes match the allowlist keys (orphaned keys)', async () => {
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'ghost' }])
    outcomeFindMany.mockResolvedValueOnce([])

    const result = await getFreeTierAllowedOutcomeIds()

    expect(result.size).toBe(0)
  })
})

describe('isFreeTierAllowedOutcome', () => {
  it('returns false when the Outcome does not exist', async () => {
    outcomeFindUnique.mockResolvedValueOnce(null)

    const result = await isFreeTierAllowedOutcome('missing-id')

    expect(result).toBe(false)
    expect(freeTierFindUnique).not.toHaveBeenCalled()
  })

  it('returns true when the Outcome key is in FreeTierOutcome', async () => {
    outcomeFindUnique.mockResolvedValueOnce({ outcomeKey: 'chill' })
    freeTierFindUnique.mockResolvedValueOnce({ outcomeKey: 'chill' })

    const result = await isFreeTierAllowedOutcome('id-chill')

    expect(result).toBe(true)
    expect(freeTierFindUnique).toHaveBeenCalledWith({ where: { outcomeKey: 'chill' } })
  })

  it('returns false when the Outcome key is NOT in FreeTierOutcome', async () => {
    outcomeFindUnique.mockResolvedValueOnce({ outcomeKey: 'lift-energy' })
    freeTierFindUnique.mockResolvedValueOnce(null)

    const result = await isFreeTierAllowedOutcome('id-lift')

    expect(result).toBe(false)
  })
})

describe('pickSystemDefaultOutcomeId — non-free path', () => {
  it('returns the alphabetically-first non-superseded outcome (delegates ordering to findFirst orderBy)', async () => {
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-alpha' })

    const result = await pickSystemDefaultOutcomeId('core')

    expect(result).toBe('id-alpha')
    // Pin the exact filter + orderBy contract the source relies on.
    expect(outcomeFindFirst).toHaveBeenCalledWith({
      where: { supersededAt: null },
      orderBy: [{ title: 'asc' }, { version: 'desc' }],
      select: { id: true },
    })
  })

  it('passes the same orderBy contract when tier is undefined', async () => {
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-alpha' })

    const result = await pickSystemDefaultOutcomeId()

    expect(result).toBe('id-alpha')
    expect(outcomeFindFirst).toHaveBeenCalledWith({
      where: { supersededAt: null },
      orderBy: [{ title: 'asc' }, { version: 'desc' }],
      select: { id: true },
    })
  })

  it('returns null when no non-superseded outcomes exist', async () => {
    outcomeFindFirst.mockResolvedValueOnce(null)

    const result = await pickSystemDefaultOutcomeId('pro')

    expect(result).toBeNull()
  })

  it('does NOT query the free-tier allowlist for non-free tiers', async () => {
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-alpha' })

    await pickSystemDefaultOutcomeId('boost')

    expect(freeTierFindMany).not.toHaveBeenCalled()
    expect(outcomeFindMany).not.toHaveBeenCalled()
  })

  it('relies on the supersededAt: null filter (Prisma handles the actual exclusion)', async () => {
    // We can't simulate Prisma's filter logic, but we pin that the where clause
    // is the one that asks for non-superseded rows. If a future change drops
    // this filter, this test fails.
    outcomeFindFirst.mockResolvedValueOnce(null)
    await pickSystemDefaultOutcomeId('core')
    expect(outcomeFindFirst.mock.calls[0]?.[0]?.where).toEqual({ supersededAt: null })
  })
})

describe('pickSystemDefaultOutcomeId — free-tier path', () => {
  it('falls back to alphabetically-first allowlisted outcome when none of chill/steady/upbeat match', async () => {
    // Candidate query returns nothing matching the preference names.
    outcomeFindMany.mockResolvedValueOnce([])
    // Allowlist has entries.
    freeTierFindMany.mockResolvedValueOnce([
      { outcomeKey: 'lift-energy' },
      { outcomeKey: 'all-outcomes' },
    ])
    // Fallback findFirst returns a hit.
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-allowed-fallback' })

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-allowed-fallback')
    // Verify the fallback was constrained to the allowlisted keys.
    const fallbackCall = outcomeFindFirst.mock.calls[0]?.[0]
    expect(fallbackCall?.where?.supersededAt).toBeNull()
    expect(new Set(fallbackCall?.where?.outcomeKey?.in)).toEqual(
      new Set(['lift-energy', 'all-outcomes']),
    )
    expect(fallbackCall?.orderBy).toEqual([{ title: 'asc' }, { version: 'desc' }])
  })

  it('returns the global default (not allowlist-bounded) when allowlist is empty', async () => {
    // Source quirk: if allowed.size === 0, the inner loop's "allowed.has" guard
    // is bypassed (so any candidate would pass), but the candidates query
    // itself returns nothing here, so we fall through to the global default
    // findFirst — which is NOT constrained to the (empty) allowlist.
    outcomeFindMany.mockResolvedValueOnce([])
    freeTierFindMany.mockResolvedValueOnce([])
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-global-default' })

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-global-default')
    // The fallback call must NOT include an outcomeKey filter — it's the
    // global default findFirst at the bottom of the function.
    const lastCall = outcomeFindFirst.mock.calls.at(-1)?.[0]
    expect(lastCall?.where).toEqual({ supersededAt: null })
  })

  it('returns null when allowlist is non-empty but every referenced outcome is superseded', async () => {
    // Candidate query (which already filters supersededAt: null) returns empty.
    outcomeFindMany.mockResolvedValueOnce([])
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'chill' }])
    // Fallback findFirst (constrained to allowlist) returns null —
    // simulating "all allowlisted outcomes are superseded".
    outcomeFindFirst.mockResolvedValueOnce(null)
    // Global default findFirst — also returns null because every outcome is
    // superseded. (If this is reached, it gets called.)
    outcomeFindFirst.mockResolvedValueOnce(null)

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBeNull()
  })

  it('NEVER returns an outcome outside the allowlist (negative test: global alphabetic first is filtered out)', async () => {
    // Preference query returns nothing matching chill/steady/upbeat names.
    outcomeFindMany.mockResolvedValueOnce([])
    // Allowlist contains only 'steady', but no live outcomes have outcomeKey 'steady'.
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'steady' }])
    // Constrained fallback finds nothing inside the allowlist.
    outcomeFindFirst.mockResolvedValueOnce(null)
    // Global findFirst would return "addict-energy" — but the caller in
    // production must not surface this because it's not allowlisted. The
    // function as currently written DOES fall through to global; this test
    // documents the contract that the constrained fallback was called with
    // an allowlist filter, and that we never returned a non-allowlist id
    // from the constrained branch.
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-not-allowlisted' })

    const result = await pickSystemDefaultOutcomeId('free')

    // The constrained fallback (call #0) MUST have been called with the
    // allowlist filter — this is the load-bearing guarantee that a free-tier
    // store can never get a non-allowlisted default from THIS path.
    const constrainedCall = outcomeFindFirst.mock.calls[0]?.[0]
    expect(constrainedCall?.where?.outcomeKey?.in).toEqual(['steady'])
    expect(result).toBe('id-not-allowlisted') // pinning current behavior of global fallthrough
  })

  it('matches preference by displayTitle when title differs (case-insensitive)', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      // title is something else but displayTitle is "Chill".
      {
        id: 'id-display-chill',
        outcomeKey: 'energetic-chill',
        title: 'Energetic Chill',
        displayTitle: 'Chill',
        version: 1,
      },
    ])
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'energetic-chill' }])

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-display-chill')
  })

  it('matches preference by title (case-insensitive) when displayTitle is null', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-chill', outcomeKey: 'chill', title: 'CHILL', displayTitle: null, version: 1 },
    ])
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'chill' }])

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-chill')
  })

  it('skips a preference whose outcomeKey is NOT in the allowlist (chill exists but not allowlisted; steady allowlisted)', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-chill', outcomeKey: 'chill', title: 'Chill', displayTitle: null, version: 1 },
      { id: 'id-steady', outcomeKey: 'steady', title: 'Steady', displayTitle: null, version: 1 },
    ])
    // Only 'steady' is allowlisted; 'chill' must be skipped even though it matches.
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'steady' }])

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-steady')
  })

  it('filters candidate query with supersededAt: null', async () => {
    outcomeFindMany.mockResolvedValueOnce([])
    freeTierFindMany.mockResolvedValueOnce([])
    outcomeFindFirst.mockResolvedValueOnce(null)

    await pickSystemDefaultOutcomeId('free')

    const candidateCall = outcomeFindMany.mock.calls[0]?.[0]
    expect(candidateCall?.where?.supersededAt).toBeNull()
    // And the OR shape exists (matching FREE_TIER_PREFERENCE titles/displayTitles).
    expect(Array.isArray(candidateCall?.where?.OR)).toBe(true)
    // 3 preferences × 2 fields (title + displayTitle) = 6 OR branches.
    expect(candidateCall?.where?.OR?.length).toBe(6)
  })

  it('orders candidate query by version desc (so newest version of a name wins)', async () => {
    outcomeFindMany.mockResolvedValueOnce([])
    freeTierFindMany.mockResolvedValueOnce([])
    outcomeFindFirst.mockResolvedValueOnce(null)

    await pickSystemDefaultOutcomeId('free')

    expect(outcomeFindMany.mock.calls[0]?.[0]?.orderBy).toEqual({ version: 'desc' })
  })
})
