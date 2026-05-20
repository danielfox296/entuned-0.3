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
import { sendAdminSignup, sendWelcome } from './email.js'
import { FREE_TIER_ICP_ID } from './freeTier.js'
import { pickSystemDefaultOutcomeId } from './outcomes.js'

const PLAYER_URL = process.env.PLAYER_URL ?? 'https://music.entuned.co'
const APP_URL = process.env.APP_URL ?? 'https://app.entuned.co'

// Slugs end up in the customer's player URL (music.entuned.co/<slug>), so
// they should be recognizable as the business name. Total slug length is
// capped at 40 chars including the `-XXXX` random suffix; that leaves 35
// chars for the name portion, which fits most real business names without
// producing ugly URLs.
const MAX_SLUG_LENGTH = 40
const SUFFIX_LENGTH = 5 // dash + 4 hex chars
const MAX_BASE_LENGTH = MAX_SLUG_LENGTH - SUFFIX_LENGTH

function slugify(name: string): string {
  // Tokenize on whitespace, lowercase, strip non-[a-z0-9] within each token,
  // drop empties. Then pack tokens joined by '-' while staying ≤ MAX_BASE_LENGTH.
  // If the first token alone exceeds the cap, hard-truncate it.
  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)

  let base = ''
  for (const tok of tokens) {
    const next = base ? `${base}-${tok}` : tok
    if (next.length <= MAX_BASE_LENGTH) {
      base = next
    } else if (!base) {
      base = tok.slice(0, MAX_BASE_LENGTH)
      break
    } else {
      break
    }
  }

  const suffix = randomBytes(2).toString('hex')
  return `${base || 'store'}-${suffix}`
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
 * Ensure the Account has a Client (with membership) and at least one Store.
 * Idempotent: if a membership already exists, returns without creating duplicates.
 *
 * Every first sign-in gets a fresh Client + ClientMembership + free-tier
 * Store. Customer Clients without an attached owner Account are unreachable
 * from self-serve sign-in (this path would auto-provision a fresh Client
 * instead) — admins attach them explicitly via POST /admin/clients/:id/owner.
 *
 * The Free Tier system sentinel (FREE_TIER_CLIENT_ID) is the only Client
 * that intentionally has zero memberships; it's not a customer.
 *
 * Called from the magic-link verify and Google OAuth callback paths.
 */
export async function ensureFreeClientForUser(accountId: string, email: string): Promise<void> {
  const existing = await prisma.clientMembership.findFirst({
    where: { accountId },
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
      data: { clientId: client.id, accountId, role: 'owner' },
    })
    const s = await uniqueStoreSlug(localPart)
    // Pick a free-tier-appropriate default outcome at creation time so the
    // Store is launchable out-of-the-box (no "set a default outcome" hard-
    // blocker on first login), and never gets a non-allowlisted outcome.
    const defaultOutcomeId = await pickSystemDefaultOutcomeId('free')
    const store = await tx.store.create({
      data: {
        clientId: client.id,
        name: `${localPart} — Main`,
        slug: s,
        tier: 'free',
        defaultOutcomeId,
        // UTC is honest about not knowing the user's tz at signup time.
        // The customer dashboard surfaces this and prompts them to set the
        // real tz; until they do, schedule slots roll at UTC midnight.
        timezone: 'UTC',
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

  const playerUrl = `${PLAYER_URL}/${slug}`

  // Welcome email — best-effort, never blocks sign-in. Resend dev mode logs instead.
  await sendWelcome(normalized, 'free', playerUrl, APP_URL).catch(() => undefined)

  // Operator notification to ADMIN_EMAIL — best-effort, never blocks sign-in.
  // Skipped automatically when ADMIN_EMAIL is unset.
  await sendAdminSignup({
    userEmail: normalized,
    companyName: localPart,
    playerUrl,
    signedUpAt: new Date().toISOString(),
  }).catch(() => undefined)
}
