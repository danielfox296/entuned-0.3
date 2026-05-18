// Common fixture builders for tests.
//
// Returns plausible-shaped objects that mocked Prisma calls can resolve to.
// Each builder accepts a partial override so tests only specify the fields
// they actually care about.
//
// Keep builders small. If a fixture starts needing extensive setup,
// consider whether the test under it is testing too many things at once.

/**
 * A Store row in the shape `prisma.store.findUnique` / `findFirst` returns.
 * Matches the actual schema fields the application reads — add more fields
 * here as test cases need them.
 */
export interface StoreFixture {
  id: string
  name: string
  slug: string
  tier: string
  compTier: string | null
  compExpiresAt: Date | null
  timezone: string
  archivedAt: Date | null
  pausedUntil: Date | null
}

export function makeStore(overrides: Partial<StoreFixture> = {}): StoreFixture {
  return {
    id: 'store-00000000-0000-0000-0000-000000000001',
    name: 'Test Store',
    slug: 'test-store-0001',
    tier: 'free',
    compTier: null,
    compExpiresAt: null,
    timezone: 'America/Denver',
    archivedAt: null,
    pausedUntil: null,
    ...overrides,
  }
}
