// Free-tier provisioning (post-Account/Location merger 2026-05-04).
//
// Every authenticated User must have a Client + ClientMembership + Store
// (tier='free', no Subscription) so the dashboard, player URL, and
// per-Client features work uniformly for free and paid users.
//
// Stripe checkout creates additional paid Stores on the same Client (it
// does not touch the free Store); the free Store stays as the always-on
// baseline.

import { randomBytes } from 'node:crypto'
import { prisma } from '../db.js'
import { sendWelcome } from './email.js'
import { FREE_TIER_ICP_ID } from './freeTier.js'

const PLAYER_URL = process.env.PLAYER_URL ?? 'https://music.entuned.co'
const APP_URL = process.env.APP_URL ?? 'https://app.entuned.co'

function slugify(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? 'store').toLowerCase().replace(/[^a-z0-9]/g, '')
  const suffix = randomBytes(2).toString('hex')
  return `${first || 'store'}-${suffix}`
}

export async function uniqueStoreSlug(name: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = slugify(name)
    const existing = await prisma.store.findUnique({ where: { slug } })
    if (!existing) return slug
  }
  return `${slugify(name)}-${randomBytes(3).toString('hex')}`
}

/**
 * Ensure the User has a Client (with membership) and at least one Store.
 * Idempotent: if a membership already exists, returns without creating duplicates.
 *
 * Every first sign-in gets a fresh Client + ClientMembership + free-tier
 * Store. Operator-managed Clients (UNTUCKit, Lululemon, Friends-Demo) are
 * intentionally inaccessible from self-serve sign-in; if a human at one of
 * those needs dashboard access, an admin attaches them explicitly.
 *
 * Called from the magic-link verify and Google OAuth callback paths.
 */
export async function ensureFreeClientForUser(userId: string, email: string): Promise<void> {
  const existing = await prisma.clientMembership.findFirst({
    where: { userId },
    select: { id: true },
  })
  if (existing) return

  const normalized = email.trim().toLowerCase()
  const localPart = normalized.split('@')[0] || 'account'

  const slug = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: { companyName: localPart },
    })
    await tx.clientMembership.create({
      data: { clientId: client.id, userId, role: 'owner' },
    })
    const s = await uniqueStoreSlug(localPart)
    const store = await tx.store.create({
      data: {
        clientId: client.id,
        name: `${localPart} — Main`,
        slug: s,
        tier: 'free',
        timezone: 'America/Denver',
      },
    })
    // Link the new free Store to the canonical Free Tier ICP so Hendrix
    // can route plays through the standard ICP pool path (no special-case
    // for icps.length === 0 anywhere downstream).
    await tx.storeICP.create({
      data: { storeId: store.id, icpId: FREE_TIER_ICP_ID },
    })
    return s
  })

  // Welcome email — best-effort, never blocks sign-in. Resend dev mode logs instead.
  await sendWelcome(normalized, 'free', `${PLAYER_URL}/${slug}`, APP_URL).catch(() => undefined)
}
