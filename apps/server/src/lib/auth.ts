// Lightweight auth for the in-store admin/Dash surface (/auth/*).
// Stateless Bearer tokens (HMAC signed with AUTH_SECRET). The customer
// dashboard uses cookie sessions instead — see lib/session.ts.
//
// Both surfaces resolve to the unified Account table (post-merge 2026-05-09).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../db.js'

const SECRET = process.env.AUTH_SECRET ?? (() => {
  // Stable-ish per-process fallback for dev; production must set AUTH_SECRET.
  const s = randomBytes(32).toString('hex')
  console.warn('[auth] AUTH_SECRET not set; using ephemeral secret. Sessions will not survive restart.')
  return s
})()

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface TokenPayload {
  accountId: string
  email: string
  isAdmin: boolean
  // Token version. Bumped on password change / admin-triggered revoke /
  // email change. Routes that consult the account row should reject
  // `payload.tv !== account.tokenVersion`.
  tv: number
  exp: number
}

function sign(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verify(token: string): TokenPayload | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    if (payload.exp < Date.now()) return null
    if (typeof payload.tv !== 'number') payload.tv = 0
    return payload
  } catch {
    return null
  }
}

/**
 * Mint a new account token. Reads the account's current `tokenVersion` so
 * the minted token survives until the next bump.
 */
export function signAccountToken(acc: { id: string; email: string; isAdmin: boolean; tokenVersion: number }): { token: string; payload: TokenPayload } {
  const payload: TokenPayload = {
    accountId: acc.id,
    email: acc.email,
    isAdmin: acc.isAdmin,
    tv: acc.tokenVersion,
    exp: Date.now() + TOKEN_TTL_MS,
  }
  return { token: sign(payload), payload }
}

export async function login(email: string, password: string): Promise<{ token: string; account: TokenPayload } | null> {
  const normalized = email.trim().toLowerCase()
  const acc = await prisma.account.findUnique({ where: { email: normalized } })
  if (!acc || acc.disabledAt || !acc.passwordHash) return null
  const ok = await bcrypt.compare(password, acc.passwordHash)
  if (!ok) return null
  const { token, payload } = signAccountToken(acc)
  return { token, account: payload }
}

export async function isAccountAuthorizedForStore(accountId: string, storeId: string): Promise<boolean> {
  const acc = await prisma.account.findUnique({ where: { id: accountId } })
  if (!acc || acc.disabledAt) return false
  if (acc.isAdmin) return true
  const assignment = await prisma.storeAssignment.findUnique({
    where: { accountId_storeId: { accountId, storeId } },
  })
  return !!assignment
}
