import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma BEFORE importing account.ts. account.ts imports `prisma` from
// '../db.js'. ensureFreeClientForUser uses prisma.$transaction(cb) and inside
// the callback calls client.create / clientMembership.create / store.create /
// storeICP.create against the tx client. Canonical pattern (per tier.test.ts)
// is to have $transaction invoke its callback against the same mocked client
// so the inner mutations land on these mocks.
vi.mock('../db.js', () => {
  const store = { findUnique: vi.fn(), create: vi.fn() }
  const client = { create: vi.fn() }
  const clientMembership = { findFirst: vi.fn(), create: vi.fn() }
  const storeICP = { create: vi.fn() }
  const prisma: Record<string, unknown> = { store, client, clientMembership, storeICP }
  prisma.$transaction = vi.fn(async (cb: (db: typeof prisma) => Promise<unknown>) => cb(prisma))
  return { prisma }
})

// Mock the outcomes module so we control pickSystemDefaultOutcomeId and can
// assert it was called with the correct tier argument.
vi.mock('./outcomes.js', () => ({
  pickSystemDefaultOutcomeId: vi.fn(),
}))

// Mock the email module so we don't actually try to send mail and can assert
// the welcome email was triggered exactly when expected.
vi.mock('./email.js', () => ({
  sendWelcome: vi.fn(),
  sendAdminSignup: vi.fn(),
}))

// Mock node:crypto's randomBytes so slug suffixes are deterministic. The
// account.ts module uses randomBytes(2) → 4 hex chars for the slug suffix,
// and randomBytes(3) → 6 hex chars for the exhaustion-fallback. The mocked
// function returns a Buffer whose toString('hex') yields a predictable suffix
// based on the call sequence.
let randomBytesCallCounter = 0
const randomBytesSequence: string[] = []
vi.mock('node:crypto', () => ({
  randomBytes: vi.fn((size: number) => {
    const next = randomBytesSequence[randomBytesCallCounter] ?? 'ab'.repeat(size)
    randomBytesCallCounter++
    // Return an object with toString('hex'). Caller only uses .toString('hex').
    return { toString: (enc: string) => (enc === 'hex' ? next : next) }
  }),
}))

import { uniqueStoreSlug, ensureFreeClientForUser } from './account.js'
import { prisma } from '../db.js'
import { pickSystemDefaultOutcomeId } from './outcomes.js'
import { sendWelcome, sendAdminSignup } from './email.js'
import { FREE_TIER_ICP_ID } from './freeTier.js'

const storeFindUnique = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>
const storeCreate = prisma.store.create as unknown as ReturnType<typeof vi.fn>
const clientCreate = prisma.client.create as unknown as ReturnType<typeof vi.fn>
const membershipFindFirst = prisma.clientMembership.findFirst as unknown as ReturnType<typeof vi.fn>
const membershipCreate = prisma.clientMembership.create as unknown as ReturnType<typeof vi.fn>
const storeIcpCreate = prisma.storeICP.create as unknown as ReturnType<typeof vi.fn>
const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
const pickDefault = pickSystemDefaultOutcomeId as unknown as ReturnType<typeof vi.fn>
const sendWelcomeMock = sendWelcome as unknown as ReturnType<typeof vi.fn>
const sendAdminSignupMock = sendAdminSignup as unknown as ReturnType<typeof vi.fn>

function setRandomBytesSequence(values: string[]): void {
  randomBytesSequence.length = 0
  for (const v of values) randomBytesSequence.push(v)
  randomBytesCallCounter = 0
}

beforeEach(() => {
  vi.clearAllMocks()
  setRandomBytesSequence([])
  // Re-install the $transaction(cb) → cb(prisma) behavior since clearAllMocks
  // wipes the implementation.
  txMock.mockImplementation(async (cb: (db: typeof prisma) => Promise<unknown>) => cb(prisma))
  // Default: sendWelcome resolves successfully (best-effort, never throws in test).
  sendWelcomeMock.mockResolvedValue({ ok: true })
  sendAdminSignupMock.mockResolvedValue({ ok: true })
})

// ============================================================================
// uniqueStoreSlug
// ============================================================================

describe('uniqueStoreSlug', () => {
  it('returns a slug from a clean lowercase name with a hex suffix', async () => {
    setRandomBytesSequence(['1a2b'])
    storeFindUnique.mockResolvedValueOnce(null)

    const slug = await uniqueStoreSlug('acme')

    expect(slug).toBe('acme-1a2b')
    expect(storeFindUnique).toHaveBeenCalledTimes(1)
    expect(storeFindUnique).toHaveBeenCalledWith({ where: { slug: 'acme-1a2b' } })
  })

  it('strips non-alphanumeric characters and lowercases each token, joining with hyphens', async () => {
    setRandomBytesSequence(['ffff'])
    storeFindUnique.mockResolvedValueOnce(null)

    const slug = await uniqueStoreSlug("O'Reilly's Bookstore")

    // Both tokens survive, punctuation stripped, lowercased, joined by '-':
    // "O'Reilly's" → "oreillys", "Bookstore" → "bookstore".
    expect(slug).toBe('oreillys-bookstore-ffff')
  })

  it('joins all whitespace-delimited tokens with hyphens', async () => {
    setRandomBytesSequence(['dead'])
    storeFindUnique.mockResolvedValueOnce(null)

    const slug = await uniqueStoreSlug('Big Sky Outfitters')

    expect(slug).toBe('big-sky-outfitters-dead')
  })

  it('truncates at a word boundary when joined tokens would exceed the cap', async () => {
    setRandomBytesSequence(['cafe'])
    storeFindUnique.mockResolvedValueOnce(null)

    // "big sky outfitters mountain trading company" lowercased:
    //   'big-sky-outfitters-mountain-trading' = 35 chars (the base cap)
    //   adding '-company' would push past 35, so 'company' is dropped.
    // Final slug: 35 + '-cafe' = 40 chars (the slug cap).
    const slug = await uniqueStoreSlug('Big Sky Outfitters Mountain Trading Company')

    expect(slug).toBe('big-sky-outfitters-mountain-trading-cafe')
    expect(slug.length).toBe(40)
  })

  it('hard-truncates a single very long token to fit the cap', async () => {
    setRandomBytesSequence(['feed'])
    storeFindUnique.mockResolvedValueOnce(null)

    // No spaces; one 50-char token. With no word boundary to break at,
    // hard-truncate the token to 35 chars before appending the suffix.
    const slug = await uniqueStoreSlug('supercalifragilisticexpialidociousfantasticness')

    expect(slug).toBe('supercalifragilisticexpialidociousf-feed')
    expect(slug.length).toBe(40)
  })

  it('falls back to "store" when the cleaned first token is empty', async () => {
    setRandomBytesSequence(['beef'])
    storeFindUnique.mockResolvedValueOnce(null)

    // Name is all non-alphanumeric in the first token.
    const slug = await uniqueStoreSlug('!!!')

    expect(slug).toBe('store-beef')
  })

  it('falls back to "store" when the name is empty', async () => {
    setRandomBytesSequence(['c0de'])
    storeFindUnique.mockResolvedValueOnce(null)

    const slug = await uniqueStoreSlug('')

    expect(slug).toBe('store-c0de')
  })

  it('falls back to "store" when the name is only whitespace', async () => {
    setRandomBytesSequence(['c0de'])
    storeFindUnique.mockResolvedValueOnce(null)

    const slug = await uniqueStoreSlug('   ')

    expect(slug).toBe('store-c0de')
  })

  it('strips unicode characters that are not [a-z0-9] from each token', async () => {
    setRandomBytesSequence(['1234'])
    storeFindUnique.mockResolvedValueOnce(null)

    // "Café" lowercased + 'é' stripped → "caf"; "Noir" → "noir"; joined → "caf-noir".
    const slug = await uniqueStoreSlug('Café Noir')

    expect(slug).toBe('caf-noir-1234')
  })

  it('retries when the first generated slug is already taken (collision on attempt 1, free on attempt 2)', async () => {
    setRandomBytesSequence(['aaaa', 'bbbb'])
    storeFindUnique
      .mockResolvedValueOnce({ id: 'existing' }) // first slug taken
      .mockResolvedValueOnce(null) // second free

    const slug = await uniqueStoreSlug('acme')

    expect(slug).toBe('acme-bbbb')
    expect(storeFindUnique).toHaveBeenCalledTimes(2)
    expect(storeFindUnique).toHaveBeenNthCalledWith(1, { where: { slug: 'acme-aaaa' } })
    expect(storeFindUnique).toHaveBeenNthCalledWith(2, { where: { slug: 'acme-bbbb' } })
  })

  it('tries up to 5 times in the loop before falling through to the exhaustion path', async () => {
    setRandomBytesSequence(['s1', 's2', 's3', 's4', 's5', 's6', 'xyz123'])
    // All 5 loop iterations find a collision.
    storeFindUnique
      .mockResolvedValueOnce({ id: 'x1' })
      .mockResolvedValueOnce({ id: 'x2' })
      .mockResolvedValueOnce({ id: 'x3' })
      .mockResolvedValueOnce({ id: 'x4' })
      .mockResolvedValueOnce({ id: 'x5' })

    const slug = await uniqueStoreSlug('acme')

    // The loop ran exactly 5 times before exhaustion fallback.
    expect(storeFindUnique).toHaveBeenCalledTimes(5)
    // After exhaustion, slugify is called once more (giving 's6') and a
    // separate randomBytes(3) is appended (giving 'xyz123'). The exhaustion
    // path does NOT call findUnique — it just returns the concatenated slug,
    // accepting the collision risk on this pathological branch.
    expect(slug).toBe('acme-s6-xyz123')
  })

  it('does not call findUnique on the exhaustion-fallback slug', async () => {
    setRandomBytesSequence(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'fffeed'])
    storeFindUnique
      .mockResolvedValueOnce({ id: 'x1' })
      .mockResolvedValueOnce({ id: 'x2' })
      .mockResolvedValueOnce({ id: 'x3' })
      .mockResolvedValueOnce({ id: 'x4' })
      .mockResolvedValueOnce({ id: 'x5' })

    await uniqueStoreSlug('acme')

    // Exactly 5 findUnique calls; the 6th slug is returned without a check.
    expect(storeFindUnique).toHaveBeenCalledTimes(5)
  })

  it('stops at the first free slug and does NOT exhaust the retry budget unnecessarily', async () => {
    setRandomBytesSequence(['t1', 't2', 't3', 't4', 't5'])
    storeFindUnique
      .mockResolvedValueOnce({ id: 'taken' })
      .mockResolvedValueOnce({ id: 'taken' })
      .mockResolvedValueOnce(null)

    const slug = await uniqueStoreSlug('acme')

    expect(slug).toBe('acme-t3')
    expect(storeFindUnique).toHaveBeenCalledTimes(3)
  })
})

// ============================================================================
// ensureFreeClientForUser
// ============================================================================

describe('ensureFreeClientForUser', () => {
  it('returns early without creating anything when the user already has a ClientMembership', async () => {
    membershipFindFirst.mockResolvedValueOnce({ id: 'existing-membership' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { accountId: 'acct-1' },
      select: { id: true },
    })
    expect(txMock).not.toHaveBeenCalled()
    expect(clientCreate).not.toHaveBeenCalled()
    expect(membershipCreate).not.toHaveBeenCalled()
    expect(storeCreate).not.toHaveBeenCalled()
    expect(storeIcpCreate).not.toHaveBeenCalled()
    expect(sendWelcomeMock).not.toHaveBeenCalled()
    expect(sendAdminSignupMock).not.toHaveBeenCalled()
    expect(pickDefault).not.toHaveBeenCalled()
  })

  it('creates Client + ClientMembership + Store + StoreICP atomically on first sign-in', async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-new' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-new' })
    storeFindUnique.mockResolvedValueOnce(null) // slug uniqueness check
    pickDefault.mockResolvedValueOnce('outcome-default')
    storeCreate.mockResolvedValueOnce({ id: 'store-new' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-new' })

    await ensureFreeClientForUser('acct-1', 'alice@example.com')

    expect(txMock).toHaveBeenCalledTimes(1)
    expect(clientCreate).toHaveBeenCalledTimes(1)
    expect(membershipCreate).toHaveBeenCalledTimes(1)
    expect(storeCreate).toHaveBeenCalledTimes(1)
    expect(storeIcpCreate).toHaveBeenCalledTimes(1)
  })

  it('derives companyName from the email local-part (lowercased, trimmed)', async () => {
    setRandomBytesSequence(['aaaa'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', '  Alice.Smith@Example.COM  ')

    expect(clientCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ companyName: 'alice.smith' }) })
  })

  it('falls back to "account" companyName when the email has no usable local-part', async () => {
    setRandomBytesSequence(['aaaa'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    // Email starts with '@' so split('@')[0] === '' → fallback to 'account'.
    await ensureFreeClientForUser('acct-1', '@example.com')

    expect(clientCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ companyName: 'account' }) })
  })

  it('creates the ClientMembership with role="owner" linked to the new client and account', async () => {
    setRandomBytesSequence(['aaaa'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-99' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-42', 'bob@example.com')

    expect(membershipCreate).toHaveBeenCalledWith({
      data: { clientId: 'client-99', accountId: 'acct-42', role: 'owner' },
    })
  })

  it("calls pickSystemDefaultOutcomeId with tier='free' (load-bearing: free Stores must get free-tier-appropriate defaults)", async () => {
    setRandomBytesSequence(['aaaa'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-free-default')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(pickDefault).toHaveBeenCalledTimes(1)
    expect(pickDefault).toHaveBeenCalledWith('free')
  })

  it('wires pickSystemDefaultOutcomeId result into the Store create defaultOutcomeId field', async () => {
    setRandomBytesSequence(['cafe'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-wired-id')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'gary@example.com')

    const call = storeCreate.mock.calls[0]?.[0]
    expect(call.data.defaultOutcomeId).toBe('outcome-wired-id')
  })

  it('creates the Store with tier="free", timezone="UTC", and a derived name', async () => {
    setRandomBytesSequence(['dead'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'gary@example.com')

    const call = storeCreate.mock.calls[0]?.[0]
    expect(call.data.tier).toBe('free')
    expect(call.data.timezone).toBe('UTC')
    expect(call.data.name).toBe('gary — Main')
    expect(call.data.clientId).toBe('client-1')
    expect(typeof call.data.slug).toBe('string')
    expect(call.data.slug.startsWith('gary-')).toBe(true)
  })

  it('links the new Store to the canonical FREE_TIER_ICP_ID via storeICP.create', async () => {
    setRandomBytesSequence(['1111'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-77' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(storeIcpCreate).toHaveBeenCalledWith({
      data: { storeId: 'store-77', icpId: FREE_TIER_ICP_ID },
    })
  })

  it("sends the welcome email once on creation (with tier='free' and the player+app URLs)", async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'NewUser@Example.com')

    expect(sendWelcomeMock).toHaveBeenCalledTimes(1)
    const [to, tier, playerUrl, appUrl] = sendWelcomeMock.mock.calls[0]!
    expect(to).toBe('newuser@example.com')
    expect(tier).toBe('free')
    // Player URL is built from the slug just produced in the transaction.
    expect(playerUrl).toMatch(/\/newuser-1234$/)
    // App URL has a known default.
    expect(typeof appUrl).toBe('string')
    expect(appUrl.length).toBeGreaterThan(0)
  })

  it('does NOT send a welcome email when membership already exists', async () => {
    membershipFindFirst.mockResolvedValueOnce({ id: 'existing-membership' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(sendWelcomeMock).not.toHaveBeenCalled()
  })

  it('notifies ADMIN_EMAIL once on creation with normalized email, companyName, playerUrl, and an ISO timestamp', async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', '  NewUser@Example.COM  ')

    expect(sendAdminSignupMock).toHaveBeenCalledTimes(1)
    const arg = sendAdminSignupMock.mock.calls[0]![0]
    expect(arg.userEmail).toBe('newuser@example.com')
    expect(arg.companyName).toBe('newuser')
    expect(arg.playerUrl).toMatch(/\/newuser-1234$/)
    // ISO-8601 timestamp.
    expect(arg.signedUpAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('does NOT notify ADMIN_EMAIL when membership already exists', async () => {
    membershipFindFirst.mockResolvedValueOnce({ id: 'existing-membership' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(sendAdminSignupMock).not.toHaveBeenCalled()
  })

  it('writes first-touch attribution onto the new Client and surfaces its summary in the admin email', async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'user@example.com', {
      referrer: 'https://www.reddit.com/r/smallbusiness',
      landingPath: '/for-apparel',
      utmSource: 'reddit',
      utmMedium: 'social',
      utmCampaign: 'spring',
      utmTerm: null,
      utmContent: null,
    })

    expect(clientCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attrReferrer: 'https://www.reddit.com/r/smallbusiness',
        attrLandingPath: '/for-apparel',
        attrUtmSource: 'reddit',
        attrUtmMedium: 'social',
        attrUtmCampaign: 'spring',
        attrUtmTerm: null,
        attrUtmContent: null,
      }),
    })
    expect(sendAdminSignupMock.mock.calls[0]![0].source).toBe(
      'utm: reddit / social / spring · via www.reddit.com · landed /for-apparel',
    )
  })

  it('writes null attribution columns and a "Direct / unknown" source when no attribution is passed', async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(clientCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ attrReferrer: null, attrUtmSource: null }),
    })
    expect(sendAdminSignupMock.mock.calls[0]![0].source).toBe('Direct / unknown')
  })

  it('swallows sendAdminSignup errors (best-effort, never blocks sign-in)', async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })
    sendAdminSignupMock.mockRejectedValueOnce(new Error('resend exploded'))

    await expect(ensureFreeClientForUser('acct-1', 'user@example.com')).resolves.toBeUndefined()
    expect(sendAdminSignupMock).toHaveBeenCalledTimes(1)
  })

  it('swallows sendWelcome errors (best-effort, never blocks sign-in)', async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })
    sendWelcomeMock.mockRejectedValueOnce(new Error('resend exploded'))

    await expect(ensureFreeClientForUser('acct-1', 'user@example.com')).resolves.toBeUndefined()
    expect(sendWelcomeMock).toHaveBeenCalledTimes(1)
  })

  it('wraps Client + membership + Store + StoreICP creation in a single $transaction', async () => {
    setRandomBytesSequence(['1234'])
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    // Exactly one transaction is opened.
    expect(txMock).toHaveBeenCalledTimes(1)
    // And it's the function form — i.e. interactive transaction, not an array.
    expect(typeof txMock.mock.calls[0]?.[0]).toBe('function')
  })

  it('does not run any mutations when the early-return path is taken (existing membership)', async () => {
    membershipFindFirst.mockResolvedValueOnce({ id: 'existing' })

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(clientCreate).not.toHaveBeenCalled()
    expect(membershipCreate).not.toHaveBeenCalled()
    expect(storeCreate).not.toHaveBeenCalled()
    expect(storeIcpCreate).not.toHaveBeenCalled()
  })

  it('selects only { id: true } when looking up an existing ClientMembership (avoids loading full row)', async () => {
    membershipFindFirst.mockResolvedValueOnce(null)
    clientCreate.mockResolvedValueOnce({ id: 'client-1' })
    membershipCreate.mockResolvedValueOnce({ id: 'mem-1' })
    storeFindUnique.mockResolvedValueOnce(null)
    pickDefault.mockResolvedValueOnce('outcome-x')
    storeCreate.mockResolvedValueOnce({ id: 'store-1' })
    storeIcpCreate.mockResolvedValueOnce({ id: 'sicp-1' })
    setRandomBytesSequence(['1234'])

    await ensureFreeClientForUser('acct-1', 'user@example.com')

    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { accountId: 'acct-1' },
      select: { id: true },
    })
  })
})
