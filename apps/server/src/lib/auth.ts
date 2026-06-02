// Lightweight auth for the in-store admin/Dash surface (/auth/*).
// Stateless Bearer tokens (HMAC signed with AUTH_SECRET). The customer
// dashboard uses cookie sessions instead — see lib/session.ts.
//
// Both surfaces resolve to the unified Account table (post-merge 2026-05-09).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
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

// ────────────────────────────────────────────────────────────────────────────
// Shared admin guard for the Dash/admin surface (/admin/*).
//
// Single source of truth for the Bearer + isAdmin check used by every admin
// route plugin (admin, admin-retention, admin-reliability, admin-imports).
// Previously this was copy-pasted in each file and had drifted (one returned
// { error: 'forbidden' } instead of { error: 'admin_required' }).
// ────────────────────────────────────────────────────────────────────────────

/** Authenticated operator resolved by `requireAdmin`. */
export interface AuthedOp {
  accountId: string
  email: string
  isAdmin: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by `adminPreHandler` on admin routes. Non-null inside handlers. */
    operator?: AuthedOp | null
  }
}

/**
 * Verify the request carries a valid admin Bearer token and the operator is
 * still active with a matching token version. On success returns the operator;
 * on failure sends the appropriate 401/403 reply and returns null.
 *
 * Failure envelopes (the contract Dash clients depend on):
 *   - missing/malformed Bearer → 401 { error: 'unauthorized' }
 *   - bad signature/expired    → 401 { error: 'invalid_token' }
 *   - valid token, not admin   → 403 { error: 'admin_required' }
 *   - operator gone/disabled   → 403 { error: 'admin_required' }
 *   - token version mismatch   → 401 { error: 'token_revoked' }
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthedOp | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  const payload = verify(auth.slice(7))
  if (!payload) {
    reply.code(401).send({ error: 'invalid_token' })
    return null
  }
  if (!payload.isAdmin) {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }
  // Re-verify the operator is still active and the token's version matches
  // the operator's current tokenVersion (bumped on password change / revoke).
  const op = await prisma.account.findUnique({ where: { id: payload.accountId } })
  if (!op || op.disabledAt || !op.isAdmin) {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }
  if (op.tokenVersion !== payload.tv) {
    reply.code(401).send({ error: 'token_revoked' })
    return null
  }
  return { accountId: op.id, email: op.email, isAdmin: op.isAdmin }
}

/**
 * Fastify preHandler that guards an entire admin route plugin. On success it
 * stashes the operator on `req.operator` (read by handlers as `req.operator!`);
 * on failure `requireAdmin` has already sent the 401/403 reply, so returning
 * short-circuits the route.
 */
export const adminPreHandler: preHandlerAsyncHookHandler = async (req, reply) => {
  const op = await requireAdmin(req, reply)
  if (!op) return reply // reply already sent by requireAdmin
  req.operator = op
}

/**
 * Idempotently register the `operator` request decorator on `app`.
 *
 * `decorateRequest` is global (not encapsulated) in Fastify and throws if the
 * same name is registered twice. In production all four admin plugins share
 * the one root app, so only the first call decorates; the rest are no-ops. In
 * tests each plugin is mounted on its own isolated app and decorates once.
 * Call this at plugin scope before adding `adminPreHandler`.
 */
export function ensureOperatorDecorator(app: FastifyInstance): void {
  if (!app.hasRequestDecorator('operator')) {
    app.decorateRequest('operator', null)
  }
}
