// Free-tier account provisioning.
//
// Every authenticated user must have an Account + AccountMembership +
// Location (tier='free', no Subscription) so the dashboard, player URL,
// and per-account features work uniformly for free and paid users.
//
// Stripe checkout creates additional paid Locations on the same Account
// (it does not touch the free Location); the free Location stays as the
// always-on baseline.

import { randomBytes } from 'node:crypto'
import { prisma } from '../db.js'

function slugify(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? 'store').toLowerCase().replace(/[^a-z0-9]/g, '')
  const suffix = randomBytes(2).toString('hex')
  return `${first || 'store'}-${suffix}`
}

export async function uniqueLocationSlug(name: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = slugify(name)
    const existing = await (prisma as any).location.findUnique({ where: { slug } })
    if (!existing) return slug
  }
  return `${slugify(name)}-${randomBytes(3).toString('hex')}`
}

/**
 * Ensure the user has an Account, AccountMembership, and at least one Location.
 * Idempotent: if any of these already exist, returns without creating duplicates.
 * Used at sign-in (magic-link verify + Google callback) so free users land
 * with a working account on first session.
 */
export async function ensureFreeAccountForUser(userId: string, email: string): Promise<void> {
  const existing = await (prisma as any).accountMembership.findFirst({
    where: { userId },
    select: { id: true },
  })
  if (existing) return

  const localPart = email.split('@')[0] || 'account'

  await prisma.$transaction(async (tx) => {
    const account = await (tx as any).account.create({ data: { name: localPart } })
    await (tx as any).accountMembership.create({
      data: { accountId: account.id, userId, role: 'owner' },
    })
    const slug = await uniqueLocationSlug(localPart)
    await (tx as any).location.create({
      data: {
        accountId: account.id,
        name: `${localPart} — Main`,
        slug,
        tier: 'free',
      },
    })
  })
}
