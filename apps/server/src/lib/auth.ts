// Lightweight auth: stateless tokens (signed with a server secret) on Operator login.
// Kept minimal for Phase 0 — replace with proper JWT lib if/when post-MVP work expands this.

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

interface TokenPayload {
  operatorId: string
  email: string
  isAdmin: boolean
  // Token version. Bumped on password change / admin-triggered revoke.
  // Routes that consult the operator row should reject `payload.tv !== op.tokenVersion`.
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
    // `tv` is required as of 2026-05-08. Older tokens minted before that field
    // existed will be missing it — treat as version 0 so they keep validating
    // until the next login (and fail-shut once the operator's tokenVersion is
    // bumped for any reason).
    if (typeof payload.tv !== 'number') payload.tv = 0
    return payload
  } catch {
    return null
  }
}

/**
 * Mint a new operator token. Reads the operator's current `tokenVersion` so the
 * minted token survives until the next bump.
 */
export function signOperatorToken(op: { id: string; email: string; isAdmin: boolean; tokenVersion: number }): { token: string; payload: TokenPayload } {
  const payload: TokenPayload = {
    operatorId: op.id,
    email: op.email,
    isAdmin: op.isAdmin,
    tv: op.tokenVersion,
    exp: Date.now() + TOKEN_TTL_MS,
  }
  return { token: sign(payload), payload }
}

export async function login(email: string, password: string): Promise<{ token: string; operator: TokenPayload } | null> {
  const normalized = email.trim().toLowerCase()
  const op = await prisma.operator.findUnique({ where: { email: normalized } })
  if (!op || op.disabledAt) return null
  const ok = await bcrypt.compare(password, op.passwordHash)
  if (!ok) return null
  const { token, payload } = signOperatorToken(op)
  return { token, operator: payload }
}

export async function isOperatorAuthorizedForStore(operatorId: string, storeId: string): Promise<boolean> {
  const op = await prisma.operator.findUnique({ where: { id: operatorId } })
  if (!op || op.disabledAt) return false
  if (op.isAdmin) return true
  const assignment = await prisma.operatorStoreAssignment.findUnique({
    where: { operatorId_storeId: { operatorId, storeId } },
  })
  return !!assignment
}
