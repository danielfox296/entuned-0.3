// READ-ONLY audit: enumerate operator-managed Clients (zero ClientMemberships)
// and surface candidate owner Accounts so we can decide attachments before any
// writes. Companion to the "kill operator-managed" cleanup.
//
// Usage:
//   railway run --service entuned-0.3 pnpm exec tsx apps/server/scripts/audit-operator-clients.ts
//
// Or locally:
//   pnpm exec tsx apps/server/scripts/audit-operator-clients.ts
//
// Outputs three sections to stdout:
//   1. Operator-managed Clients (zero memberships) — id, name, stores, icps,
//      contactEmail, stripeCustomerId.
//   2. Candidate owner Accounts for each — Account row matching contactEmail
//      (if any), plus their existing memberships (the "stray free-tier Client"
//      problem we have to disposition).
//   3. Admin Accounts and what they currently own — so we can spot strays
//      tied to your daniel@entuned.co or similar.

import 'dotenv/config'
import { prisma } from '../src/db.js'

async function main() {
  console.log('\n=== OPERATOR-MANAGED CLIENTS (zero ClientMemberships) ===\n')

  const allClients = await prisma.client.findMany({
    select: {
      id: true,
      companyName: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      stripeCustomerId: true,
      plan: true,
      industry: true,
      createdAt: true,
      _count: { select: { memberships: true, stores: true, icps: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const operatorManaged = allClients.filter((c) => c._count.memberships === 0)
  const plg = allClients.filter((c) => c._count.memberships > 0)

  console.log(`Total Clients: ${allClients.length} (PLG: ${plg.length}, operator-managed: ${operatorManaged.length})\n`)

  for (const c of operatorManaged) {
    console.log(`• ${c.companyName}`)
    console.log(`    id:            ${c.id}`)
    console.log(`    plan:          ${c.plan}`)
    console.log(`    industry:      ${c.industry ?? '(null — onboarding incomplete)'}`)
    console.log(`    contactName:   ${c.contactName ?? '—'}`)
    console.log(`    contactEmail:  ${c.contactEmail ?? '—'}`)
    console.log(`    contactPhone:  ${c.contactPhone ?? '—'}`)
    console.log(`    stripeCustId:  ${c.stripeCustomerId ?? '(null — never went through Checkout)'}`)
    console.log(`    stores:        ${c._count.stores}`)
    console.log(`    icps:          ${c._count.icps}`)
    console.log(`    createdAt:     ${c.createdAt.toISOString()}`)

    // Surface stores + ICPs so we know what's actually under each
    const stores = await prisma.store.findMany({
      where: { clientId: c.id },
      select: { id: true, name: true, slug: true, tier: true, archivedAt: true, goLiveDate: true },
      orderBy: { name: 'asc' },
    })
    if (stores.length) {
      console.log(`    stores:`)
      for (const s of stores) {
        const archived = s.archivedAt ? ` [archived ${s.archivedAt.toISOString()}]` : ''
        console.log(`      - ${s.name} (tier=${s.tier}, slug=${s.slug}, goLive=${s.goLiveDate?.toISOString() ?? '—'})${archived}`)
      }
    }
    const icps = await prisma.iCP.findMany({
      where: { clientId: c.id },
      select: { id: true, name: true, archivedAt: true },
      orderBy: { name: 'asc' },
    })
    if (icps.length) {
      console.log(`    icps:`)
      for (const i of icps) {
        const archived = i.archivedAt ? ` [archived]` : ''
        console.log(`      - ${i.name}${archived}`)
      }
    }

    // Candidate owner Account: match by contactEmail (case-insensitive via CITEXT)
    if (c.contactEmail) {
      const acc = await prisma.account.findUnique({
        where: { email: c.contactEmail.trim().toLowerCase() },
        select: {
          id: true,
          email: true,
          name: true,
          isAdmin: true,
          disabledAt: true,
          createdAt: true,
          lastLoginAt: true,
          memberships: {
            select: {
              role: true,
              client: { select: { id: true, companyName: true, _count: { select: { memberships: true, stores: true } } } },
            },
          },
        },
      })
      if (acc) {
        console.log(`    candidate owner Account (by contactEmail):`)
        console.log(`      id:         ${acc.id}`)
        console.log(`      email:      ${acc.email}`)
        console.log(`      name:       ${acc.name ?? '—'}`)
        console.log(`      isAdmin:    ${acc.isAdmin}`)
        console.log(`      disabledAt: ${acc.disabledAt?.toISOString() ?? '—'}`)
        console.log(`      lastLogin:  ${acc.lastLoginAt?.toISOString() ?? '—'}`)
        if (acc.memberships.length) {
          console.log(`      existing memberships (STRAY candidates):`)
          for (const m of acc.memberships) {
            console.log(`        - role=${m.role} -> "${m.client.companyName}" (id=${m.client.id}, stores=${m.client._count.stores})`)
          }
        } else {
          console.log(`      existing memberships: NONE — clean attach`)
        }
      } else {
        console.log(`    candidate owner Account (by contactEmail): NOT FOUND — no Account row exists for ${c.contactEmail}`)
      }
    } else {
      console.log(`    candidate owner Account: SKIPPED — no contactEmail on Client`)
    }
    console.log('')
  }

  console.log('\n=== ADMIN ACCOUNTS + WHAT THEY OWN ===\n')

  const admins = await prisma.account.findMany({
    where: { isAdmin: true },
    select: {
      id: true,
      email: true,
      name: true,
      disabledAt: true,
      lastLoginAt: true,
      memberships: {
        select: {
          role: true,
          client: {
            select: {
              id: true,
              companyName: true,
              industry: true,
              _count: { select: { memberships: true, stores: true } },
            },
          },
        },
      },
    },
    orderBy: { email: 'asc' },
  })

  for (const a of admins) {
    console.log(`• ${a.email}${a.disabledAt ? ' [DISABLED]' : ''}`)
    console.log(`    id:        ${a.id}`)
    console.log(`    name:      ${a.name ?? '—'}`)
    console.log(`    lastLogin: ${a.lastLoginAt?.toISOString() ?? '—'}`)
    if (a.memberships.length) {
      console.log(`    memberships:`)
      for (const m of a.memberships) {
        console.log(`      - role=${m.role} -> "${m.client.companyName}" (id=${m.client.id}, industry=${m.client.industry ?? 'null'}, stores=${m.client._count.stores})`)
      }
    } else {
      console.log(`    memberships: NONE`)
    }
    console.log('')
  }

  console.log('\n=== SUMMARY ===\n')
  console.log(`Operator-managed Clients to merge: ${operatorManaged.length}`)
  console.log(`PLG Clients (already correct shape): ${plg.length}`)
  console.log(`Admin Accounts: ${admins.length}`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
