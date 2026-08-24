// READ-ONLY signup report: what material is converting, and which signups are junk.
//
// The `Client.attr_*` columns (first-touch attribution, captured at magic-link
// verify — see lib/attribution.ts) are write-only today: nothing in Dash or the
// API ever reads them back. This script is the read side. Zero writes.
//
// Usage (prod, from the monorepo root — see ../../CLAUDE.md "Railway SSH"):
//   cd entuned-0.3 && railway ssh "pnpm exec tsx scripts/analyze-signups.ts"
//
// Or with DATABASE_URL in apps/server/.env, locally:
//   pnpm exec tsx apps/server/scripts/analyze-signups.ts
//
// Flags:
//   --days=N   lookback window on Client.createdAt (default 30)
//   --json     emit the whole report as JSON instead of the text tables
//
// Sections:
//   1. Funnel for the window (signed up → onboarded → audience → activated → paid)
//   2. Attribution coverage — how much of the window is even attributable
//   3. By landing page ("which material"), channel, and tagged creative
//   4. Signup roster — one line each, with funnel stage and quality verdict
//   5. Quality flags — the identity evidence behind every non-clean verdict
//   6. Magic links requested but never verified (bot probes / lost signups)

import 'dotenv/config'
import { prisma } from '../src/db.js'
import { EMPTY_ATTRIBUTION, type Attribution } from '../src/lib/attribution.js'
import { FREE_TIER_CLIENT_ID } from '../src/lib/freeTier.js'
import {
  attributionCoverage,
  channelOf,
  creativeOf,
  domainOf,
  funnelTotals,
  isDisposableDomain,
  materialOf,
  pct,
  rollup,
  scoreCohort,
  type RollupRow,
  type SignupRecord,
} from '../src/lib/signupInsights.js'

// Stripe statuses that mean "this store is actually paying us".
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'past_due'])

// Guard the `IN (...)` on the unverified-magic-link lookup.
const MAX_EMAIL_LOOKUP = 500

function parseArgs(argv: string[]): { days: number; json: boolean } {
  let days = 30
  let json = false
  for (const arg of argv) {
    const m = /^--days=(\d+)$/.exec(arg)
    if (m) days = Math.max(1, Number(m[1]))
    if (arg === '--json') json = true
  }
  return { days, json }
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

/** Left-pad-to-width table printer. Keeps the output readable in a terminal. */
function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log('  (none)')
    return
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  )
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
  console.log('  ' + line(headers))
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '))
  for (const r of rows) console.log('  ' + line(r))
}

/**
 * Why an unverified address is worth a second look. A disposable domain that
 * never clicked through is a probe, not a lost customer; so is one address
 * hammering /start repeatedly.
 */
function unverifiedNote(email: string, requests: number): string {
  const notes: string[] = []
  if (isDisposableDomain(domainOf(email))) notes.push('disposable inbox')
  if (requests >= 3) notes.push('repeat requests')
  return notes.length ? notes.join(', ') : '—'
}

function funnelRow(row: RollupRow): string[] {
  return [
    row.key,
    String(row.signups),
    `${row.onboarded} (${pct(row.onboarded, row.signups)})`,
    `${row.audienceBuilt} (${pct(row.audienceBuilt, row.signups)})`,
    `${row.activated} (${pct(row.activated, row.signups)})`,
    String(row.paid),
    row.flagged ? String(row.flagged) : '·',
  ]
}

const FUNNEL_HEADERS = ['', 'signups', 'onboarded', 'audience', 'activated', 'paid', 'flagged']

async function loadCohort(since: Date): Promise<SignupRecord[]> {
  // PLG signups only: a Client with at least one membership. Operator-created
  // Clients (zero memberships) and the Free Tier sentinel aren't signups.
  const clients = await prisma.client.findMany({
    where: {
      createdAt: { gte: since },
      id: { not: FREE_TIER_CLIENT_ID },
      memberships: { some: {} },
    },
    select: {
      id: true,
      companyName: true,
      industry: true,
      createdAt: true,
      attrReferrer: true,
      attrLandingPath: true,
      attrUtmSource: true,
      attrUtmMedium: true,
      attrUtmCampaign: true,
      attrUtmTerm: true,
      attrUtmContent: true,
      referredByCode: true,
      memberships: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { account: { select: { email: true, lastLoginAt: true } } },
      },
      // source='onboarding' = built via the self-serve /boost-trial flow, i.e.
      // the customer did the work themselves. Operator-made ICPs don't count.
      icps: { where: { source: 'onboarding' }, select: { id: true } },
      stores: {
        select: {
          id: true,
          tier: true,
          subscription: { select: { status: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const storeIds = clients.flatMap((c) => c.stores.map((s) => s.id))
  const playsByStore = new Map<string, { count: number; first: Date | null }>()
  if (storeIds.length > 0) {
    const grouped = await prisma.playbackEvent.groupBy({
      by: ['storeId'],
      where: { storeId: { in: storeIds } },
      _count: { _all: true },
      _min: { occurredAt: true },
    })
    for (const g of grouped) {
      playsByStore.set(g.storeId, { count: g._count._all, first: g._min.occurredAt ?? null })
    }
  }

  return clients.map((c) => {
    const attribution: Attribution = {
      ...EMPTY_ATTRIBUTION,
      referrer: c.attrReferrer,
      landingPath: c.attrLandingPath,
      utmSource: c.attrUtmSource,
      utmMedium: c.attrUtmMedium,
      utmCampaign: c.attrUtmCampaign,
      utmTerm: c.attrUtmTerm,
      utmContent: c.attrUtmContent,
      referralCode: c.referredByCode,
    }

    let playbackCount = 0
    let firstPlaybackAt: Date | null = null
    for (const s of c.stores) {
      const p = playsByStore.get(s.id)
      if (!p) continue
      playbackCount += p.count
      if (p.first && (!firstPlaybackAt || p.first < firstPlaybackAt)) firstPlaybackAt = p.first
    }

    const paid = c.stores.some(
      (s) =>
        s.tier !== 'free' ||
        (s.subscription != null && LIVE_SUBSCRIPTION_STATUSES.has(s.subscription.status)),
    )

    return {
      clientId: c.id,
      companyName: c.companyName,
      email: c.memberships[0]?.account?.email ?? null,
      signedUpAt: c.createdAt,
      lastLoginAt: c.memberships[0]?.account?.lastLoginAt ?? null,
      industry: c.industry,
      attribution,
      ownIcpCount: c.icps.length,
      playbackCount,
      firstPlaybackAt,
      paid,
    }
  })
}

/**
 * Emails that asked for a magic link in the window but never landed an Account.
 * A cluster here with no matching signups is what a scripted /start probe looks
 * like; a lone one is usually a real person whose link went to spam.
 */
async function loadUnverified(since: Date) {
  const tokens = await prisma.magicLinkToken.findMany({
    where: { createdAt: { gte: since } },
    select: { email: true, createdAt: true, consumedAt: true, attrLandingPath: true },
    orderBy: { createdAt: 'asc' },
  })

  const byEmail = new Map<
    string,
    { requests: number; consumed: number; first: Date; last: Date; landingPath: string | null }
  >()
  for (const t of tokens) {
    const key = t.email.toLowerCase()
    const e = byEmail.get(key)
    if (!e) {
      byEmail.set(key, {
        requests: 1,
        consumed: t.consumedAt ? 1 : 0,
        first: t.createdAt,
        last: t.createdAt,
        landingPath: t.attrLandingPath,
      })
    } else {
      e.requests += 1
      if (t.consumedAt) e.consumed += 1
      if (t.createdAt < e.first) e.first = t.createdAt
      if (t.createdAt > e.last) e.last = t.createdAt
      if (!e.landingPath) e.landingPath = t.attrLandingPath
    }
  }

  const neverConsumed = [...byEmail.entries()].filter(([, v]) => v.consumed === 0)
  if (neverConsumed.length === 0) return { rows: [], truncated: false }

  // Someone can have an unconsumed token in the window and still hold an older
  // Account — that's a returning user, not a lost signup. Filter them out.
  const emails = neverConsumed.slice(0, MAX_EMAIL_LOOKUP).map(([e]) => e)
  const existing = await prisma.account.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  })
  const haveAccounts = new Set(existing.map((a) => a.email.toLowerCase()))

  const rows = neverConsumed
    .slice(0, MAX_EMAIL_LOOKUP)
    .filter(([email]) => !haveAccounts.has(email))
    .map(([email, v]) => ({ email, ...v }))
    .sort((a, b) => b.requests - a.requests || b.last.getTime() - a.last.getTime())

  return { rows, truncated: neverConsumed.length > MAX_EMAIL_LOOKUP }
}

async function main() {
  const { days, json } = parseArgs(process.argv.slice(2))
  const now = new Date()
  const since = new Date(now.getTime() - days * 86_400_000)

  const records = await loadCohort(since)
  const cohort = scoreCohort(records, now)
  const totals = funnelTotals(cohort)
  const coverage = attributionCoverage(records)
  const unverified = await loadUnverified(since)

  const byMaterial = rollup(cohort, (r) => materialOf(r.attribution))
  const byChannel = rollup(cohort, (r) => channelOf(r.attribution))
  const byCreative = rollup(
    cohort.filter((r) => creativeOf(r.attribution) !== null),
    (r) => creativeOf(r.attribution)!,
  )

  if (json) {
    console.log(
      JSON.stringify(
        {
          window: { days, since: since.toISOString(), until: now.toISOString() },
          totals,
          coverage,
          byMaterial,
          byChannel,
          byCreative,
          signups: cohort.map((r) => ({
            clientId: r.clientId,
            email: r.email,
            companyName: r.companyName,
            signedUpAt: r.signedUpAt.toISOString(),
            stage: r.stage,
            channel: channelOf(r.attribution),
            material: materialOf(r.attribution),
            creative: creativeOf(r.attribution),
            playbackCount: r.playbackCount,
            paid: r.paid,
            verdict: r.verdict,
          })),
          unverifiedMagicLinks: unverified.rows.map((r) => ({
            ...r,
            first: r.first.toISOString(),
            last: r.last.toISOString(),
          })),
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(`\n=== SIGNUPS — last ${days} days (since ${fmtDate(since)} UTC) ===\n`)

  if (cohort.length === 0) {
    console.log('  No PLG signups in this window.\n')
  } else {
    console.log('── Funnel ──')
    printTable(FUNNEL_HEADERS, [funnelRow({ ...totals, key: 'all signups' })])
    console.log(
      `\n  Quality: ${totals.clean} clean · ${totals.flagged - totals.likelySpam} suspect · ${totals.likelySpam} likely spam`,
    )

    console.log('\n── Attribution coverage ──')
    console.log(
      `  ${coverage.withAny}/${coverage.total} (${pct(coverage.withAny, coverage.total)}) carry any attribution` +
        ` · ${coverage.withUtm} tagged with UTM · ${coverage.withLandingPath} have a landing path`,
    )
    if (coverage.withAny < coverage.total) {
      console.log(
        `  ${coverage.total - coverage.withAny} arrived with nothing captured — they land in "direct / unknown"` +
          ` and are NOT evidence that direct is working.`,
      )
    }

    console.log('\n── By landing page (what material) ──')
    printTable(FUNNEL_HEADERS, byMaterial.map(funnelRow))

    console.log('\n── By channel ──')
    printTable(FUNNEL_HEADERS, byChannel.map(funnelRow))

    console.log('\n── By tagged creative (campaign · content · term) ──')
    printTable(FUNNEL_HEADERS, byCreative.map(funnelRow))

    console.log('\n── Signup roster (newest first) ──')
    printTable(
      ['email', 'signed up', 'stage', 'plays', 'channel', 'landing', 'quality'],
      cohort.map((r) => [
        r.email ?? `(no email — client ${r.clientId.slice(0, 8)})`,
        fmtDate(r.signedUpAt),
        r.stage,
        String(r.playbackCount),
        channelOf(r.attribution),
        materialOf(r.attribution),
        r.verdict.level === 'clean' ? `clean/${r.verdict.engagement}` : r.verdict.level,
      ]),
    )

    const flagged = cohort.filter((r) => r.verdict.level !== 'clean')
    console.log('\n── Quality flags ──')
    if (flagged.length === 0) {
      console.log('  (none — every signup in the window looks like a real person)')
    } else {
      for (const r of flagged) {
        console.log(`  • ${r.email ?? r.clientId} — ${r.verdict.level} (score ${r.verdict.score})`)
        for (const reason of r.verdict.reasons) console.log(`      – ${reason}`)
        console.log(`      – engagement: ${r.verdict.engagementNote}`)
      }
    }

    // Dormant-but-clean is a different problem from spam: real people who
    // bounced. Worth its own line so it doesn't hide inside "clean".
    const dormant = cohort.filter(
      (r) => r.verdict.level === 'clean' && r.verdict.engagement === 'dormant',
    )
    if (dormant.length > 0) {
      console.log(
        `\n  ${dormant.length} signup(s) look real but never did anything: ` +
          dormant.map((r) => r.email ?? r.clientId).join(', '),
      )
    }
  }

  console.log('\n── Magic links requested, never verified ──')
  if (unverified.rows.length === 0) {
    console.log('  (none)')
  } else {
    printTable(
      ['email', 'requests', 'first', 'last', 'landing', 'note'],
      unverified.rows.map((r) => [
        r.email,
        String(r.requests),
        fmtDate(r.first),
        fmtDate(r.last),
        r.landingPath ?? '—',
        unverifiedNote(r.email, r.requests),
      ]),
    )
    if (unverified.truncated) {
      console.log(`  (truncated at ${MAX_EMAIL_LOOKUP} addresses)`)
    }
  }

  console.log('')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
