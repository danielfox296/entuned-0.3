// Free-tier provisioning (post-Account/Location merger 2026-05-04).
//
// Every authenticated User must have a Client + ClientMembership + Store
// (tier='free', no Subscription) so the dashboard, player URL, and
// per-Client features work uniformly for free and paid users.
//
// Stripe checkout creates additional paid Stores on the same Client (it
// does not touch the free Store); the free Store stays as the always-on
// baseline.
//
// Operator-link hook: if the email matches an existing Client.contact_email
// (e.g. an operator-managed customer like Untuckit), we link the User to
// that Client rather than creating a new one. This is the path option C
// from the migration design.

import { randomBytes } from 'node:crypto'
import { prisma } from '../db.js'
import { sendWelcome } from './email.js'

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
 * Resolution order on first sign-in:
 *  1. If the email matches an existing Client.contact_email, link via membership
 *     (operator-managed customer, e.g. Untuckit, gets dashboard access).
 *  2. Otherwise create a fresh Client + ClientMembership + free-tier Store.
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

  // Operator-link hook: match by Client.contact_email.
  const operatorClient = await prisma.client.findFirst({
    where: { contactEmail: normalized },
    select: { id: true },
  })

  if (operatorClient) {
    // Existing Client owns one or more Stores already. Just attach membership.
    await prisma.clientMembership.create({
      data: { clientId: operatorClient.id, userId, role: 'owner' },
    })
    // Don't send a welcome email — they already know what they bought.
    return
  }

  // Fresh free-tier Client + Store.
  const localPart = normalized.split('@')[0] || 'account'

  const slug = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: { companyName: localPart },
    })
    await tx.clientMembership.create({
      data: { clientId: client.id, userId, role: 'owner' },
    })
    const s = await uniqueStoreSlug(localPart)
    await tx.store.create({
      data: {
        clientId: client.id,
        name: `${localPart} — Main`,
        slug: s,
        tier: 'free',
        timezone: 'America/Denver',
      },
    })
    return s
  })

  // Welcome email — best-effort, never blocks sign-in. Resend dev mode logs instead.
  await sendWelcome(normalized, 'free', `${PLAYER_URL}/${slug}`, APP_URL).catch(() => undefined)
}
