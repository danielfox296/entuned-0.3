// One-shot backfill: attach owner Accounts to the two operator-managed
// Clients (Untuckit, Lululemon). After this runs, the only Client with
// zero memberships should be the Free Tier system sentinel
// (00000000-0000-0000-0000-000000000001).
//
// Mirrors the logic of POST /admin/clients/:id/owner — kept separate so we
// can run it from this machine without an admin Bearer token. Idempotent.
//
// Usage:
//   DATABASE_URL=<prod public URL> pnpm exec tsx scripts/attach-untuckit-lululemon-owners.ts

import 'dotenv/config'
import { prisma } from '../src/db.js'

const TARGETS: Array<{ clientId: string; ownerEmail: string }> = [
  { clientId: '595a8d4a-357d-43c2-aa22-9a727177f720', ownerEmail: 'daniel+untuckit@entuned.co' },
  { clientId: '2069081e-b6ad-4fce-848d-85e47f40dbcb', ownerEmail: 'daniel+lululemon@entuned.co' },
]

async function attachOne(clientId: string, ownerEmail: string) {
  const normalized = ownerEmail.trim().toLowerCase()

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, companyName: true },
  })
  if (!client) {
    console.log(`  ✗ Client ${clientId} not found — SKIPPED`)
    return
  }

  await prisma.$transaction(async (tx) => {
    let account = await tx.account.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, disabledAt: true, memberships: { select: { clientId: true } } },
    })
    let accountCreated = false
    if (!account) {
      const created = await tx.account.create({
        data: { email: normalized },
        select: { id: true, email: true, disabledAt: true },
      })
      account = { ...created, memberships: [] }
      accountCreated = true
    }
    if (account.disabledAt) {
      console.log(`  ✗ ${normalized} is disabled — SKIPPED`)
      return
    }

    if (account.memberships.some((m) => m.clientId === clientId)) {
      console.log(`  ⊙ ${normalized} already attached to "${client.companyName}" — IDEMPOTENT`)
      return
    }
    const elsewhere = account.memberships.find((m) => m.clientId !== clientId)
    if (elsewhere) {
      console.log(`  ✗ ${normalized} already has a membership for Client ${elsewhere.clientId} — REFUSED (clear it first)`)
      return
    }

    const membership = await tx.clientMembership.create({
      data: { clientId, accountId: account.id, role: 'owner' },
      select: { id: true, createdAt: true },
    })
    const verb = accountCreated ? 'Created Account + attached' : 'Attached existing Account'
    console.log(`  ✓ ${verb} ${normalized} as owner of "${client.companyName}" (membership=${membership.id})`)
  })
}

async function main() {
  console.log('Attaching owners…\n')
  for (const t of TARGETS) {
    console.log(`Client ${t.clientId} → ${t.ownerEmail}`)
    await attachOne(t.clientId, t.ownerEmail)
    console.log('')
  }
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
