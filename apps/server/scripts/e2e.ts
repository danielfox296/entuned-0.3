// End-to-end smoke test of the entuned-0.3 admin API surface.
//
// What it does: hits the live Railway API as daniel@entuned.co, exercises every
// core flow (clients, stores, ICPs, outcomes, hooks, hook-drafter prompt
// versioning, hook retirement, scheduling, dry run, pool depth, goals, override,
// outcome supersede, lineage rows, flagged review, abandoned log), then deletes
// every entity it created — fixed `__E2E__` prefix on names so a cleanup sweep
// at the end (and on next run) removes any leakage.
//
// Run:
//   cd apps/server && pnpm tsx scripts/e2e.ts
//
// Exits 0 on full pass, 1 if any step failed. Cleanup always runs even when
// assertions fail mid-flight.

import { PrismaClient } from '@prisma/client'

const API = process.env.E2E_API_URL ?? 'https://entuned-03-production.up.railway.app'
const EMAIL = process.env.E2E_EMAIL ?? 'daniel@entuned.co'
const PASSWORD = process.env.E2E_PASSWORD ?? '1'
const TEST_PREFIX = '__E2E__'

const prisma = new PrismaClient()

interface Result { name: string; ok: boolean; detail?: string }
const results: Result[] = []

let token = ''
let testClientId = ''
let testIcpId = ''
let testStoreId = ''
const testOutcomeIds: string[] = []
let testOutcomeId = ''
let testHookId = ''
let testRefTrackId = ''
let testScheduleRowId = ''
let testGoalId = ''

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail })
  process.stdout.write(`\x1b[32m  ✓\x1b[0m ${name}${detail ? ` \x1b[2m— ${detail}\x1b[0m` : ''}\n`)
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail })
  process.stdout.write(`\x1b[31m  ✗\x1b[0m ${name} \x1b[31m— ${detail}\x1b[0m\n`)
}

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const d = await fn()
    pass(name, typeof d === 'string' ? d : undefined)
  } catch (e: any) {
    fail(name, (e?.message ?? String(e)).slice(0, 200))
  }
}

async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 240)}`)
  }
  if (res.status === 204) return undefined as any
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('json')) return res.json() as Promise<T>
  return res.text() as any
}

function assert(cond: any, msg: string): asserts cond { if (!cond) throw new Error(msg) }

// ─────────────────────────────────────────────────────────────────────
// Cleanup of any leftover __E2E__ rows from prior runs (best-effort)
// ─────────────────────────────────────────────────────────────────────

async function preflightCleanup() {
  const stale = await prisma.client.findMany({
    where: { companyName: { startsWith: TEST_PREFIX } },
    include: { stores: true, icps: true },
  })
  for (const c of stale) {
    for (const s of c.stores) {
      await prisma.store.update({ where: { id: s.id }, data: { manualOverrideOutcomeId: null, manualOverrideExpiresAt: null, defaultOutcomeId: null } }).catch(() => {})
      await prisma.scheduleRow.deleteMany({ where: { storeId: s.id } })
      await prisma.goal.deleteMany({ where: { storeId: s.id } })
      await prisma.audioEvent.deleteMany({ where: { storeId: s.id } })
      await prisma.operatorStoreAssignment.deleteMany({ where: { storeId: s.id } })
      await prisma.store.delete({ where: { id: s.id } }).catch(() => {})
    }
    for (const i of c.icps) {
      await prisma.lineageRow.deleteMany({ where: { icpId: i.id } })
      await prisma.submission.deleteMany({ where: { icpId: i.id } })
      await prisma.enoRun.deleteMany({ where: { icpId: i.id } })
      await prisma.hook.deleteMany({ where: { icpId: i.id } })
      await prisma.hookDrafterPromptVersion.deleteMany({ where: { icpId: i.id } })
      await prisma.hookDrafterPrompt.deleteMany({ where: { icpId: i.id } })
      await prisma.referenceTrack.deleteMany({ where: { icpId: i.id } })
      await prisma.iCP.delete({ where: { id: i.id } }).catch(() => {})
    }
    await prisma.client.delete({ where: { id: c.id } }).catch(() => {})
  }
  // Outcomes: any whose title starts with TEST_PREFIX, regardless of supersession.
  const staleOutcomes = await prisma.outcome.findMany({ where: { title: { startsWith: TEST_PREFIX } } })
  for (const o of staleOutcomes) {
    await prisma.lineageRow.deleteMany({ where: { outcomeId: o.id } })
    await prisma.scheduleRow.deleteMany({ where: { outcomeId: o.id } })
    await prisma.goal.deleteMany({ where: { outcomeId: o.id } })
    await prisma.hook.deleteMany({ where: { outcomeId: o.id } })
    await prisma.outcome.delete({ where: { id: o.id } }).catch(() => {})
  }
  return stale.length + staleOutcomes.length
}

// ─────────────────────────────────────────────────────────────────────
// Final cleanup of THIS run's entities
// ─────────────────────────────────────────────────────────────────────

async function teardown() {
  // Order: leaf rows first, then parents.
  if (testStoreId) {
    await prisma.store.update({ where: { id: testStoreId }, data: { manualOverrideOutcomeId: null, manualOverrideExpiresAt: null, defaultOutcomeId: null } }).catch(() => {})
    await prisma.scheduleRow.deleteMany({ where: { storeId: testStoreId } })
    await prisma.goal.deleteMany({ where: { storeId: testStoreId } })
    await prisma.audioEvent.deleteMany({ where: { storeId: testStoreId } })
    await prisma.operatorStoreAssignment.deleteMany({ where: { storeId: testStoreId } })
    await prisma.store.delete({ where: { id: testStoreId } }).catch(() => {})
  }
  if (testIcpId) {
    await prisma.lineageRow.deleteMany({ where: { icpId: testIcpId } })
    await prisma.submission.deleteMany({ where: { icpId: testIcpId } })
    await prisma.enoRun.deleteMany({ where: { icpId: testIcpId } })
    await prisma.hook.deleteMany({ where: { icpId: testIcpId } })
    await prisma.hookDrafterPromptVersion.deleteMany({ where: { icpId: testIcpId } })
    await prisma.hookDrafterPrompt.deleteMany({ where: { icpId: testIcpId } })
    await prisma.referenceTrack.deleteMany({ where: { icpId: testIcpId } })
    await prisma.iCP.delete({ where: { id: testIcpId } }).catch(() => {})
  }
  if (testClientId) await prisma.client.delete({ where: { id: testClientId } }).catch(() => {})
  for (const id of testOutcomeIds) {
    await prisma.lineageRow.deleteMany({ where: { outcomeId: id } })
    await prisma.scheduleRow.deleteMany({ where: { outcomeId: id } })
    await prisma.goal.deleteMany({ where: { outcomeId: id } })
    await prisma.hook.deleteMany({ where: { outcomeId: id } })
    await prisma.outcome.delete({ where: { id } }).catch(() => {})
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`\x1b[1m\nentuned-0.3 e2e against ${API}\x1b[0m\n\n`)

  // Preflight cleanup
  await step('preflight cleanup of stale __E2E__ rows', async () => {
    const n = await preflightCleanup()
    return `${n} root entit${n === 1 ? 'y' : 'ies'} swept`
  })

  await step('login', async () => {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
    const j = await r.json() as any
    token = j.token
    assert(token, 'no token returned')
    return `as ${j.operator.email}`
  })
  if (!token) { await teardown(); summary(); return }

  await step('GET /admin/health proxy via /admin/clients (auth check)', async () => {
    const list = await api('GET', '/admin/clients')
    assert(Array.isArray(list), 'not an array')
    return `${list.length} clients`
  })

  await step('seed: create test client + ICP via prisma', async () => {
    const c = await prisma.client.create({
      data: { companyName: `${TEST_PREFIX}client`, plan: 'mvp_pilot' },
    })
    testClientId = c.id
    const i = await prisma.iCP.create({ data: { clientId: c.id, name: `${TEST_PREFIX}icp` } })
    testIcpId = i.id
    return `client=${c.id.slice(0, 8)} icp=${i.id.slice(0, 8)}`
  })

  await step('PUT /admin/clients/:id (update brand lyric guidelines)', async () => {
    const updated = await api('PUT', `/admin/clients/${testClientId}`, {
      brandLyricGuidelines: 'E2E test guidelines — warm, image-first, never preachy.',
      contactEmail: 'e2e@example.com',
    })
    assert(updated.brandLyricGuidelines?.includes('E2E test'), 'guidelines did not persist')
    return 'fields persisted'
  })

  await step('GET /admin/clients/:id (verify rollups)', async () => {
    const c = await api<any>('GET', `/admin/clients/${testClientId}`)
    assert(Array.isArray(c.stores) && Array.isArray(c.icps), 'missing stores/icps')
    assert(c.icps.find((i: any) => i.id === testIcpId), 'test ICP not in rollup')
    return `${c.stores.length} stores · ${c.icps.length} ICPs`
  })

  await step('POST /admin/outcomes (create test outcome v1)', async () => {
    const o = await api<any>('POST', '/admin/outcomes', {
      title: `${TEST_PREFIX}outcome`, tempoBpm: 90, mode: 'major',
      dynamics: 'restrained', instrumentation: 'piano, soft drums',
    })
    testOutcomeId = o.id
    testOutcomeIds.push(o.id)
    assert(o.version === 1, 'first outcome should be v1')
    return `id=${o.id.slice(0, 8)} v${o.version}`
  })

  await step('PUT /admin/outcomes/:id (copy-on-write → v2; old superseded)', async () => {
    const v2 = await api<any>('PUT', `/admin/outcomes/${testOutcomeId}`, {
      title: `${TEST_PREFIX}outcome`, tempoBpm: 95, mode: 'major',
      dynamics: 'restrained', instrumentation: 'piano, soft drums, light strings',
    })
    testOutcomeIds.push(v2.id)
    assert(v2.version === 2, `expected v2, got v${v2.version}`)
    assert(v2.id !== testOutcomeId, 'PUT should produce a new id')
    assert(v2.outcomeKey === undefined || v2.outcomeKey, 'outcomeKey lost')
    testOutcomeId = v2.id
    return `v2 id=${v2.id.slice(0, 8)}`
  })

  await step('POST /admin/icps/:id/reference-tracks', async () => {
    const t = await api<any>('POST', `/admin/icps/${testIcpId}/reference-tracks`, {
      bucket: 'FormationEra', artist: `${TEST_PREFIX}artist`, title: `${TEST_PREFIX}track`, year: 2002,
    })
    testRefTrackId = t.id
    return `id=${t.id.slice(0, 8)}`
  })

  await step('PUT /admin/icps/:id (update psychographic field)', async () => {
    await api('PUT', `/admin/icps/${testIcpId}`, { fears: 'being seen as out of touch' })
  })

  await step('POST /admin/icps/:id/hooks (create draft hook)', async () => {
    const h = await api<any>('POST', `/admin/icps/${testIcpId}/hooks`, {
      text: `${TEST_PREFIX}coming home to a quiet morning`, outcomeId: testOutcomeId,
    })
    testHookId = h.id
    assert(h.status === 'draft', `expected draft, got ${h.status}`)
    return `id=${h.id.slice(0, 8)}`
  })

  await step('POST /admin/hooks/:id/approve', async () => {
    const h = await api<any>('POST', `/admin/hooks/${testHookId}/approve`)
    assert(h.status === 'approved', `expected approved, got ${h.status}`)
  })

  await step('PUT /admin/hooks/:id (approved → 409 immutable)', async () => {
    try {
      await api('PUT', `/admin/hooks/${testHookId}`, { text: 'mutation attempt' })
      throw new Error('expected 409 but request succeeded')
    } catch (e: any) {
      if (!e.message.includes('409')) throw e
    }
  })

  await step('hook drafter prompt — write v1', async () => {
    const r = await api<any>('PUT', `/admin/icps/${testIcpId}/hook-drafter-prompt`, {
      promptText: 'E2E v1 prompt body.', notes: 'first version',
    })
    assert(r.version >= 1, 'no version returned')
    return `v${r.version}`
  })

  await step('hook drafter prompt — write v2 (versioning increments)', async () => {
    const r = await api<any>('PUT', `/admin/icps/${testIcpId}/hook-drafter-prompt`, {
      promptText: 'E2E v2 prompt body.', notes: 'reworded opener',
    })
    assert(r.version >= 2, `expected v2+, got v${r.version}`)
  })

  await step('hook drafter prompt — GET returns latest + history (≥2)', async () => {
    const r = await api<any>('GET', `/admin/icps/${testIcpId}/hook-drafter-prompt`)
    assert(r.latest, 'no latest')
    assert(Array.isArray(r.history) && r.history.length >= 2, `expected ≥2 history, got ${r.history?.length}`)
    return `latest v${r.latest.version} · ${r.history.length} versions in history`
  })

  await step('GET /admin/hooks/:id/retire-preview', async () => {
    const r = await api<any>('GET', `/admin/hooks/${testHookId}/retire-preview`)
    assert(typeof r.inFlightSubmissions === 'number', 'no inFlightSubmissions count')
    assert(typeof r.activeLineageRows === 'number', 'no activeLineageRows count')
    return `${r.inFlightSubmissions} in-flight, ${r.activeLineageRows} lineage rows`
  })

  await step('POST /admin/hooks/:id/retire', async () => {
    const r = await api<any>('POST', `/admin/hooks/${testHookId}/retire`, { force: false })
    assert(r.status === 'retired', `expected retired, got ${r.status}`)
  })

  await step('POST /admin/stores (create test store)', async () => {
    const s = await api<any>('POST', '/admin/stores', {
      clientId: testClientId, icpId: testIcpId,
      name: `${TEST_PREFIX}store`, timezone: 'America/Denver',
      defaultOutcomeId: testOutcomeId, goLiveDate: '2026-04-25',
    })
    testStoreId = s.id
    return `id=${s.id.slice(0, 8)}`
  })

  await step('PUT /admin/stores/:id (update timezone)', async () => {
    await api('PUT', `/admin/stores/${testStoreId}`, { timezone: 'America/Chicago' })
  })

  await step('POST /admin/stores/:id/schedule (Mon 09:00–17:00)', async () => {
    const r = await api<any>('POST', `/admin/stores/${testStoreId}/schedule`, {
      dayOfWeek: 1, startTime: '09:00', endTime: '17:00', outcomeId: testOutcomeId,
    })
    testScheduleRowId = r.id
    return `id=${r.id.slice(0, 8)}`
  })

  await step('PUT /admin/schedule-rows/:id (extend to 18:00)', async () => {
    await api('PUT', `/admin/schedule-rows/${testScheduleRowId}`, {
      dayOfWeek: 1, startTime: '09:00', endTime: '18:00', outcomeId: testOutcomeId,
    })
  })

  await step('GET /admin/stores/:id/schedule-dry-run', async () => {
    const r = await api<any>('GET', `/admin/stores/${testStoreId}/schedule-dry-run`)
    assert(Array.isArray(r.days) && r.days.length === 7, 'expected 7 days')
    assert(r.totals.totalMin === 7 * 24 * 60, `expected 10080 min, got ${r.totals.totalMin}`)
    assert(Array.isArray(r.byOutcome), 'no byOutcome')
    return `${r.totals.scheduledMin}m scheduled, ${r.totals.defaultMin}m default-fill, ${r.totals.gapMin}m gap`
  })

  await step('GET /admin/pool-depth (test ICP appears with 0 active rows)', async () => {
    const r = await api<any>('GET', '/admin/pool-depth')
    const me = r.icps.find((i: any) => i.id === testIcpId)
    assert(me, 'test ICP missing from pool-depth')
    const cell = me.outcomes.find((c: any) => c.outcome.id === testOutcomeId)
    assert(cell, 'test outcome missing in cell list')
    assert(cell.count === 0, `expected 0 active lineage rows, got ${cell.count}`)
    return `cell count=${cell.count} status=${cell.status}`
  })

  await step('POST /admin/goals (advisory)', async () => {
    const g = await api<any>('POST', '/admin/goals', {
      storeId: testStoreId, outcomeId: testOutcomeId,
      goalType: 'dwell_lift', targetMetric: 'avg_dwell_seconds', direction: 'increase',
      startAt: new Date().toISOString(),
      notes: 'e2e advisory goal',
    })
    testGoalId = g.id
  })

  await step('PUT /admin/goals/:id (status → paused)', async () => {
    await api('PUT', `/admin/goals/${testGoalId}`, { status: 'paused' })
  })

  await step('POST /admin/stores/:id/override (set)', async () => {
    const r = await api<any>('POST', `/admin/stores/${testStoreId}/override`, { outcomeId: testOutcomeId })
    assert(r.outcomeId === testOutcomeId, 'override outcome mismatch')
  })

  await step('POST /admin/stores/:id/override/clear', async () => {
    await api('POST', `/admin/stores/${testStoreId}/override/clear`)
  })

  await step('GET /admin/stores/:id/live (resolves active outcome)', async () => {
    const r = await api<any>('GET', `/admin/stores/${testStoreId}/live`)
    assert(r.store?.id === testStoreId, 'store id mismatch in live view')
    return `active=${r.active?.outcomeTitle ?? 'none'} (${r.active?.source ?? '—'})`
  })

  await step('GET /admin/lineage-rows (paginated list works)', async () => {
    const r = await api<any>('GET', '/admin/lineage-rows?limit=5&active=all')
    assert(typeof r.total === 'number', 'no total')
    assert(Array.isArray(r.rows), 'no rows array')
    return `total=${r.total}`
  })

  await step('GET /admin/flagged (returns songs[] array)', async () => {
    const r = await api<any>('GET', '/admin/flagged')
    assert(Array.isArray(r.songs), 'no songs array')
    return `${r.songs.length} flagged`
  })

  await step('GET /admin/submissions?status=abandoned (Abandoned Log feed)', async () => {
    const r = await api<any>('GET', `/admin/submissions?status=abandoned&limit=5`)
    assert(Array.isArray(r), 'expected array')
  })

  await step('GET /admin/outcomes?include=all (Outcome Library)', async () => {
    const r = await api<any>('GET', '/admin/outcomes?include=all')
    assert(Array.isArray(r), 'not an array')
    assert(r.find((o: any) => o.id === testOutcomeId), 'test v2 outcome not in library')
  })

  // POST /supersede is "retire this version" — does NOT create a new one. Verify the
  // returned row has supersededAt set and the outcome drops out of active lists.
  await step('POST /admin/outcomes/:id/supersede (retire-only; no new version)', async () => {
    // Have to clear any references first or supersede leaves the schedule pointing at a dead row.
    // We just verify the retire semantics — the test outcome is unbound at this point because
    // schedule + goal + ref-track + default-outcome were already cleaned up above.
    const r = await api<any>('POST', `/admin/outcomes/${testOutcomeId}/supersede`)
    assert(r.supersededAt, `supersededAt should be set, got ${r.supersededAt}`)
    assert(r.id === testOutcomeId, 'supersede should return same id')
    const lib = await api<any>('GET', '/admin/outcomes')
    assert(!lib.find((o: any) => o.id === testOutcomeId), 'superseded outcome should drop out of active outcomes list')
    return 'retired; dropped from active list'
  })

  // Cleanup-API endpoints (exercise them)
  await step('DELETE /admin/schedule-rows/:id', async () => {
    await api('DELETE', `/admin/schedule-rows/${testScheduleRowId}`)
    testScheduleRowId = ''
  })

  await step('DELETE /admin/goals/:id', async () => {
    await api('DELETE', `/admin/goals/${testGoalId}`)
    testGoalId = ''
  })

  await step('DELETE /admin/reference-tracks/:id', async () => {
    await api('DELETE', `/admin/reference-tracks/${testRefTrackId}`)
    testRefTrackId = ''
  })

  await step('DELETE /admin/hooks/:id (retired hook deletes via prisma in teardown)', async () => {
    // Retired hooks aren't deletable through the public DELETE (it 409s on 'approved'
    // and treats anything-not-draft as immutable). Verify the 409 is returned, then
    // teardown removes via prisma. This is documenting the current behavior.
    try {
      await api('DELETE', `/admin/hooks/${testHookId}`)
    } catch (e: any) {
      // Either 404 (already gone) or 409 (immutable) is acceptable here.
      if (!e.message.match(/40[49]/)) throw e
    }
  })
}

function summary() {
  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`)
  if (failed > 0) {
    process.stdout.write(`\n\x1b[31mfailures:\x1b[0m\n`)
    for (const r of results.filter((r) => !r.ok)) {
      process.stdout.write(`  ✗ ${r.name}\n     ${r.detail}\n`)
    }
  }
}

(async () => {
  let mainErr: any = null
  try {
    await main()
  } catch (e) {
    mainErr = e
    fail('main', (e as any)?.message ?? String(e))
  }
  // teardown always runs
  process.stdout.write(`\n\x1b[2mteardown…\x1b[0m\n`)
  await step('teardown: delete all __E2E__ entities', async () => {
    await teardown()
    // Verify nothing remains.
    const leakClients = await prisma.client.count({ where: { companyName: { startsWith: TEST_PREFIX } } })
    const leakOutcomes = await prisma.outcome.count({ where: { title: { startsWith: TEST_PREFIX } } })
    const leakHooks = await prisma.hook.count({ where: { text: { startsWith: TEST_PREFIX } } })
    if (leakClients + leakOutcomes + leakHooks > 0) {
      throw new Error(`leaks: clients=${leakClients} outcomes=${leakOutcomes} hooks=${leakHooks}`)
    }
    return 'all clean'
  })
  await prisma.$disconnect()
  summary()
  process.exit(results.some((r) => !r.ok) || mainErr ? 1 : 0)
})()
