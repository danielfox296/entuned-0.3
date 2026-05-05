// One-shot migration: collapse mixed-tier Clients to a single paid Store.
//
// Background: until 2026-05-05 the Stripe webhook always created a NEW Store
// on first paid checkout, even when the Client already had an auto-provisioned
// free Store from sign-in. Result: paying customers ended up owning a free
// Store + a paid Store side by side, which violates billing decision #6 (one
// subscription per Client, quantity=N where N = paid Stores) and shows up as
// a confusing two-row Locations list.
//
// The webhook is fixed (it now transmutes the orphan free Store on first paid
// checkout). This script cleans up the existing accounts that pre-date the fix
// by archiving each Client's orphan free Store(s).
//
// "Orphan" = a Store with tier='free', no Subscription row, on a Client that
// also owns at least one Store with a Subscription. The free Store's ICPs,
// hooks, lineage, etc. were never used (paying customers operate from their
// paid Store), so archiving is safe — `archivedAt` excludes it from /me/stores
// and from any future generation pipeline.
//
// Idempotent. Run with: pnpm exec tsx apps/server/scripts/archive-mixed-tier-orphans.ts

import 'dotenv/config'
import { prisma } from '../src/db.js'

async function main() {
  const orphans = await prisma.store.findMany({
    where: {
      tier: 'free',
      archivedAt: null,
      subscription: { is: null },
      client: {
        stores: {
          some: { subscription: { isNot: null }, archivedAt: null },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      clientId: true,
      client: { select: { companyName: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (orphans.length === 0) {
    console.log('No mixed-tier orphans to archive. Already clean.')
    return
  }

  console.log(`Found ${orphans.length} orphan free Store(s) to archive:`)
  for (const o of orphans) {
    console.log(`  · ${o.client.companyName ?? '(no name)'} / ${o.name} / slug=${o.slug} / id=${o.id}`)
  }

  const archivedAt = new Date()
  const result = await prisma.store.updateMany({
    where: { id: { in: orphans.map((o) => o.id) } },
    data: { archivedAt },
  })

  console.log(`\nArchived ${result.count} Store(s) at ${archivedAt.toISOString()}.`)
}

main()
  .catch((err) => {
    console.error('archive-mixed-tier-orphans failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
