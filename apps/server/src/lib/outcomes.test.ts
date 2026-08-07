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
  isPickerHiddenOutcome,
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

// -- Pin the canonical FREE_TIER_PREFERENCE chain via observable behavior. --
// Dwell Launch Spec v1 (2026-08-06): the free tier is a SINGLE outcome, so
// FREE_TIER_PREFERENCE = ['dwell']. Prod's Dwell row is title='Dwell Extension',
// displayTitle='Dwell' — the picker matches on `displayTitle ?? title`, so the
// displayTitle path below is the one that fires in production.
describe('FREE_TIER_PREFERENCE (pinned via behavior)', () => {
  it('picks Dwell by displayTitle when title is the internal "Dwell Extension"', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      {
        id: 'id-dwell',
        outcomeKey: 'key-dwell',
        title: 'Dwell Extension',
        displayTitle: 'Dwell',
        version: 1,
      },
    ])
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'key-dwell' }])

    const result = await pickSystemDefaultOutcomeId('free')
    expect(result).toBe('id-dwell')
  })

  it('does NOT pick Chill/Steady/Upbeat even when they are the only allowlisted rows', async () => {
    // Regression guard for the repoint: the old three modes must no longer be
    // preferred. With no name match, the picker falls through to the
    // alphabetical allowlist fallback rather than short-circuiting on 'chill'.
    outcomeFindMany.mockResolvedValueOnce([]) // nothing matches the name 'dwell'
    freeTierFindMany.mockResolvedValueOnce([
      { outcomeKey: 'key-chill' },
      { outcomeKey: 'key-steady' },
      { outcomeKey: 'key-upbeat' },
    ])
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-alphabetical-fallback' })

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-alphabetical-fallback')
    // It reached the constrained fallback — i.e. no preference short-circuit.
    expect(outcomeFindFirst).toHaveBeenCalledTimes(1)
  })

  it('skips Dwell when it exists but is not allowlisted', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-dwell', outcomeKey: 'key-dwell', title: 'Dwell Extension', displayTitle: 'Dwell', version: 1 },
    ])
    // Allowlist holds something else entirely — Dwell must not be returned.
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'key-other' }])
    outcomeFindFirst.mockResolvedValueOnce({ id: 'id-other' })

    const result = await pickSystemDefaultOutcomeId('free')
    expect(result).toBe('id-other')
  })
})

describe('isPickerHiddenOutcome', () => {
  // The three retired free modes. Rows stay live in the catalogue (nothing is
  // superseded, songs keep playing) — they're only hidden from the customer
  // pickers in GET /hendrix/outcomes and GET /me/outcomes.
  it.each(['Chill', 'Steady', 'Upbeat'])('hides %s', (title) => {
    expect(isPickerHiddenOutcome({ title, displayTitle: null })).toBe(true)
  })

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(isPickerHiddenOutcome({ title: '  CHILL ', displayTitle: null })).toBe(true)
  })

  it('matches on displayTitle when it differs from title', () => {
    expect(isPickerHiddenOutcome({ title: 'Energetic Chill', displayTitle: 'Chill' })).toBe(true)
  })

  it('does NOT hide an outcome whose title contains a hidden name as a substring', () => {
    expect(isPickerHiddenOutcome({ title: 'Chill Extension', displayTitle: null })).toBe(false)
  })

  it('does not hide Dwell — the free-tier outcome', () => {
    expect(isPickerHiddenOutcome({ title: 'Dwell Extension', displayTitle: 'Dwell' })).toBe(false)
  })

  it.each([
    ['Dwell Compression', 'Keep It Moving'],
    ['Value Lift', 'Trade Them Up'],
    ['Impulse', 'Grab It Now'],
    ['Brand Match', 'Our Sound'],
  ])('does not hide the paid outcome %s / %s', (title, displayTitle) => {
    expect(isPickerHiddenOutcome({ title, displayTitle })).toBe(false)
  })

  it('tolerates a missing displayTitle field', () => {
    expect(isPickerHiddenOutcome({ title: 'Steady' })).toBe(true)
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
  it('falls back to alphabetically-first allowlisted outcome when nothing matches the preference chain', async () => {
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

  it('returns null for free tier when the FreeTierOutcome allowlist is empty', async () => {
    // Hard invariant: free Stores never get an outcome outside the allowlist.
    // An empty allowlist (admin deleted all rows, fresh DB without seed, etc.)
    // returns null rather than falling through to the global default — which
    // would silently leak paid-only outcomes into free Stores.
    outcomeFindMany.mockResolvedValueOnce([])
    freeTierFindMany.mockResolvedValueOnce([])

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBeNull()
    // Crucially: no outcome.findFirst should fire — bailing early on the
    // empty-allowlist guard prevents the silent-leak fall-through.
    expect(outcomeFindFirst).not.toHaveBeenCalled()
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

  it('NEVER returns an outcome outside the allowlist (negative test: no fall-through to global default)', async () => {
    // Preference query returns nothing matching the 'dwell' name.
    outcomeFindMany.mockResolvedValueOnce([])
    // Allowlist contains only 'steady', but no live outcomes have outcomeKey 'steady'.
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'steady' }])
    // Constrained fallback finds nothing inside the allowlist.
    outcomeFindFirst.mockResolvedValueOnce(null)

    const result = await pickSystemDefaultOutcomeId('free')

    // The constrained fallback (call #0) MUST have been called with the
    // allowlist filter — this is the load-bearing guarantee that a free-tier
    // store can never get a non-allowlisted default.
    const constrainedCall = outcomeFindFirst.mock.calls[0]?.[0]
    expect(constrainedCall?.where?.outcomeKey?.in).toEqual(['steady'])
    // When no allowlisted outcome can be found, return null rather than
    // falling through to the global default (which would leak paid-only
    // outcomes into free Stores).
    expect(result).toBeNull()
    // No second findFirst — global fall-through must not run on the free path.
    expect(outcomeFindFirst).toHaveBeenCalledTimes(1)
  })

  it('matches preference by displayTitle when title differs (case-insensitive)', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      // Production shape: internal title is "Dwell Extension", display is "Dwell".
      {
        id: 'id-display-dwell',
        outcomeKey: 'key-dwell',
        title: 'Dwell Extension',
        displayTitle: 'DWELL',
        version: 1,
      },
    ])
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'key-dwell' }])

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-display-dwell')
  })

  it('matches preference by title (case-insensitive) when displayTitle is null', async () => {
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-dwell', outcomeKey: 'key-dwell', title: 'dwell', displayTitle: null, version: 1 },
    ])
    freeTierFindMany.mockResolvedValueOnce([{ outcomeKey: 'key-dwell' }])

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-dwell')
  })

  it('prefers Dwell over an allowlisted non-preference outcome', async () => {
    // Both are allowlisted; the name in FREE_TIER_PREFERENCE must win over the
    // alphabetical fallback, so no findFirst should be needed at all.
    outcomeFindMany.mockResolvedValueOnce([
      { id: 'id-dwell', outcomeKey: 'key-dwell', title: 'Dwell Extension', displayTitle: 'Dwell', version: 1 },
    ])
    freeTierFindMany.mockResolvedValueOnce([
      { outcomeKey: 'key-brand' },
      { outcomeKey: 'key-dwell' },
    ])

    const result = await pickSystemDefaultOutcomeId('free')

    expect(result).toBe('id-dwell')
    expect(outcomeFindFirst).not.toHaveBeenCalled()
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
    // 1 preference ('dwell') × 2 fields (title + displayTitle) = 2 OR branches.
    expect(candidateCall?.where?.OR?.length).toBe(2)
  })

  it('orders candidate query by version desc (so newest version of a name wins)', async () => {
    outcomeFindMany.mockResolvedValueOnce([])
    freeTierFindMany.mockResolvedValueOnce([])
    outcomeFindFirst.mockResolvedValueOnce(null)

    await pickSystemDefaultOutcomeId('free')

    expect(outcomeFindMany.mock.calls[0]?.[0]?.orderBy).toEqual({ version: 'desc' })
  })
})
