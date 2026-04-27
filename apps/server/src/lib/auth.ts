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
    return payload
  } catch {
    return null
  }
}

export async function login(email: string, password: string): Promise<{ token: string; operator: TokenPayload } | null> {
  const normalized = email.trim().toLowerCase()
  const op = await prisma.operator.findUnique({ where: { email: normalized } })
  if (!op || op.disabledAt) return null
  const ok = await bcrypt.compare(password, op.passwordHash)
  if (!ok) return null
  const payload: TokenPayload = {
    operatorId: op.id,
    email: op.email,
    isAdmin: op.isAdmin,
    exp: Date.now() + TOKEN_TTL_MS,
  }
  return { token: sign(payload), operator: payload }
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
