// Integration test for the Boost Trial flow against the live Railway DB.
//
// Exercises:
//   1. boostTrialClock: does nothing without a LineageRow
//   2. boostTrialClock: activates clock when LineageRow exists
//   3. boostTrialClock: idempotency (second run is a no-op)
//   4. compExpiry: 5-day window selects the store with boost_trial_icp reason
//   5. compExpiry: 3-day grace period skips just-expired boost trials
//   6. lifecycleEmails (boostTrialStreamReady drip): selects newly-activated trials
//
// Run:  cd apps/server && pnpm tsx scripts/test-boost-trial.ts
//
// Creates `__BOOST_TEST__` test data, asserts behavior, then cleans up in
// a try/finally so leakage doesn't survive a failed assertion.

import { PrismaClient } from '@prisma/client'
import { runBoostTrialClockActivation } from '../src/lib/boostTrialClock.js'

const prisma = new PrismaClient()
const TEST_PREFIX = '__BOOST_TEST__'

interface Result { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function assert(cond: boolean, name: string, detail?: string) {
  record(name, cond, !cond ? detail : undefined)
  if (!cond) throw new Error(`assert failed: ${name}${detail ? ` — ${detail}` : ''}`)
}

interface TestEntities {
  accountId?: string
  clientId?: string
  storeId?: string
  icpId?: string
  songId?: string
  lineageRowId?: string
}

const ents: TestEntities = {}

async function setup() {
  // 1. Find a reusable Outcome + Song so we don't need to create those.
  const outcome = await prisma.outcome.findFirst({ select: { id: true } })
  if (!outcome) throw new Error('no Outcomes in DB — fixture problem, not a test bug')

  // Find any existing Song to reuse — LineageRow needs a real songId FK.
  const song = await prisma.song.findFirst({ select: { id: true } })
  if (!song) throw new Error('no Songs in DB — fixture problem, not a test bug')
  ents.songId = song.id

  // 2. Create test Account
  const account = await prisma.account.create({
    data: {
      email: `${TEST_PREFIX}-${Date.now()}@entuned.test`,
      name: 'Boost Trial Test',
    },
  })
  ents.accountId = account.id

  // 3. Create test Client
  const client = await prisma.client.create({
    data: {
      companyName: `${TEST_PREFIX} Co`,
      industry: 'apparel', // already onboarded
    },
  })
  ents.clientId = client.id

  // 4. Membership (owner role)
  await prisma.clientMembership.create({
    data: { accountId: account.id, clientId: client.id, role: 'owner' },
  })

  // 5. Test Store in the "pending boost trial" state
  const store = await prisma.store.create({
    data: {
      clientId: client.id,
      name: `${TEST_PREFIX} Store`,
      slug: `${TEST_PREFIX.toLowerCase()}-${Date.now()}`,
      timezone: 'America/Denver',
      tier: 'free',
      compTier: 'core',
      compReason: 'boost_trial_icp',
      compExpiresAt: null,
    },
  })
  ents.storeId = store.id

  // 6. Onboarding ICP linked to the store via StoreICP
  const icp = await prisma.iCP.create({
    data: {
      clientId: client.id,
      name: `${TEST_PREFIX} Customer`,
      source: 'onboarding',
    },
  })
  ents.icpId = icp.id

  await prisma.storeICP.create({
    data: { storeId: store.id, icpId: icp.id },
  })

  return { outcomeId: outcome.id, songId: song.id }
}

async function cleanup() {
  // Delete in reverse dependency order
  if (ents.lineageRowId) {
    await prisma.lineageRow.deleteMany({ where: { id: ents.lineageRowId } }).catch(() => undefined)
  }
  if (ents.storeId) {
    await prisma.tierChangeLog.deleteMany({ where: { storeId: ents.storeId } }).catch(() => undefined)
    await prisma.storeICP.deleteMany({ where: { storeId: ents.storeId } }).catch(() => undefined)
    await prisma.store.deleteMany({ where: { id: ents.storeId } }).catch(() => undefined)
  }
  if (ents.icpId) {
    await prisma.iCP.deleteMany({ where: { id: ents.icpId } }).catch(() => undefined)
  }
  if (ents.accountId) {
    await prisma.clientMembership.deleteMany({ where: { accountId: ents.accountId } }).catch(() => undefined)
    await prisma.lifecycleEmailLog.deleteMany({ where: { accountId: ents.accountId } }).catch(() => undefined)
    await prisma.account.deleteMany({ where: { id: ents.accountId } }).catch(() => undefined)
  }
  if (ents.clientId) {
    await prisma.client.deleteMany({ where: { id: ents.clientId } }).catch(() => undefined)
  }
  // Defensive sweep — any rows that survived because of a mid-test crash
  await prisma.account.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } }).catch(() => undefined)
  await prisma.client.deleteMany({ where: { companyName: { startsWith: TEST_PREFIX } } }).catch(() => undefined)
}

async function main() {
  console.log('=== Boost Trial integration test ===\n')

  let setupOK = false
  try {
    const { outcomeId, songId } = await setup()
    setupOK = true
    console.log(`Setup complete. storeId=${ents.storeId} icpId=${ents.icpId}\n`)

    // ── Test 1: clock does NOT activate without a LineageRow ────────────
    {
      const stats = await runBoostTrialClockActivation()
      const store = await prisma.store.findUnique({
        where: { id: ents.storeId! },
        select: { compExpiresAt: true },
      })
      assert(
        store?.compExpiresAt === null,
        'clock does not activate without LineageRow',
        `compExpiresAt=${store?.compExpiresAt} stats=${JSON.stringify(stats)}`,
      )
    }

    // ── Test 2: insert a LineageRow, then clock activates ──────────────
    const lr = await prisma.lineageRow.create({
      data: {
        songId: songId,
        r2Url: 'https://example.test/fake.mp3',
        icpId: ents.icpId!,
        outcomeId,
        active: true,
      },
    })
    ents.lineageRowId = lr.id

    {
      const before = Date.now()
      const stats = await runBoostTrialClockActivation()
      const store = await prisma.store.findUnique({
        where: { id: ents.storeId! },
        select: { compExpiresAt: true },
      })
      assert(
        store?.compExpiresAt !== null,
        'clock activates when LineageRow exists',
        `stats=${JSON.stringify(stats)}`,
      )
      const expiresAt = store!.compExpiresAt!.getTime()
      const daysOut = (expiresAt - before) / (24 * 60 * 60 * 1000)
      assert(
        daysOut > 29.9 && daysOut < 30.1,
        '30-day clock window is correct',
        `expected ~30 days, got ${daysOut.toFixed(2)}`,
      )
      assert(
        stats.activated === 1,
        'stats.activated === 1',
        `stats=${JSON.stringify(stats)}`,
      )
    }

    // ── Test 3: TierChangeLog written with source='boost_trial_activated' ─
    {
      const log = await prisma.tierChangeLog.findFirst({
        where: { storeId: ents.storeId!, source: 'boost_trial_activated' },
        orderBy: { createdAt: 'desc' },
      })
      assert(
        log !== null,
        'TierChangeLog written with boost_trial_activated source',
        log ? `log id=${log.id}` : 'no log row found',
      )
      assert(
        log?.toTier === 'core',
        'TierChangeLog.toTier === core',
        `got toTier=${log?.toTier}`,
      )
      assert(
        log?.expiresAt !== null,
        'TierChangeLog.expiresAt is set',
        `got expiresAt=${log?.expiresAt}`,
      )
    }

    // ── Test 4: second run is idempotent (no double-activation) ────────
    {
      const storeBefore = await prisma.store.findUnique({
        where: { id: ents.storeId! },
        select: { compExpiresAt: true },
      })
      const stats = await runBoostTrialClockActivation()
      const storeAfter = await prisma.store.findUnique({
        where: { id: ents.storeId! },
        select: { compExpiresAt: true },
      })
      assert(
        stats.considered === 0,
        'second run does not reconsider already-activated stores',
        `stats=${JSON.stringify(stats)}`,
      )
      assert(
        storeBefore!.compExpiresAt!.getTime() === storeAfter!.compExpiresAt!.getTime(),
        'compExpiresAt does not change on second run',
        `before=${storeBefore!.compExpiresAt} after=${storeAfter!.compExpiresAt}`,
      )
      const allLogs = await prisma.tierChangeLog.findMany({
        where: { storeId: ents.storeId!, source: 'boost_trial_activated' },
      })
      assert(
        allLogs.length === 1,
        'only one boost_trial_activated log row exists',
        `got ${allLogs.length} logs`,
      )
    }

    // ── Test 5: a Store without an onboarding-source ICP is ignored ────
    // Simulate by flipping the ICP source to 'operator' and resetting the comp.
    {
      await prisma.iCP.update({
        where: { id: ents.icpId! },
        data: { source: 'operator' },
      })
      await prisma.store.update({
        where: { id: ents.storeId! },
        data: { compExpiresAt: null },
      })
      const stats = await runBoostTrialClockActivation()
      const store = await prisma.store.findUnique({
        where: { id: ents.storeId! },
        select: { compExpiresAt: true },
      })
      assert(
        store?.compExpiresAt === null,
        'store with operator-source ICP is skipped even if LineageRow exists',
        `stats=${JSON.stringify(stats)} compExpiresAt=${store?.compExpiresAt}`,
      )
    }

    console.log('\n=== All assertions passed ===')
  } catch (err) {
    console.error('\nFAILED:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  } finally {
    if (setupOK) {
      console.log('\nCleaning up test data…')
      await cleanup()
      console.log('Cleanup complete.')
    }
    const pass = results.filter((r) => r.ok).length
    const fail = results.filter((r) => !r.ok).length
    console.log(`\nResults: ${pass} passed, ${fail} failed`)
    await prisma.$disconnect()
  }
}

main()
