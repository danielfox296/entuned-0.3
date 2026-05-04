// Customer dashboard session — JWT in an httpOnly cookie.
//
// Distinct from `lib/auth.ts`, which mints HMAC-signed bearer tokens for in-store Operators.
// This module is for the customer dashboard (User + Account model).
//
// - Cookie name: `entuned_session`
// - 30-day rolling expiry: every request that successfully decodes a token re-issues the
//   cookie with a fresh expiry, so active users stay logged in indefinitely.
// - In production: secure, sameSite=lax, domain=`.entuned.co` (set via COOKIE_DOMAIN env var).
//   In dev: domain omitted, secure=false.

import jwt from 'jsonwebtoken'
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fp from 'fastify-plugin'
import { prisma } from '../db.js'

const COOKIE_NAME = 'entuned_session'
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

export interface SessionPayload {
  userId: string
  // `iat` / `exp` are added by jsonwebtoken automatically.
}

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export interface SessionAccount {
  id: string
  name: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser
    account?: SessionAccount
    role?: string
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET is not set (or too short). Set it in .env / Railway env.')
  }
  return secret
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

function cookieOptions(): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: string
  domain?: string
  maxAge: number
} {
  const domain = process.env.COOKIE_DOMAIN?.trim()
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
    maxAge: SESSION_TTL_SECONDS,
  }
}

/** Sign a session JWT for a user and write it to the response cookie. */
export function setSessionCookie(reply: FastifyReply, userId: string): string {
  const token = jwt.sign({ userId } satisfies SessionPayload, getJwtSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
  })
  reply.setCookie(COOKIE_NAME, token, cookieOptions())
  return token
}

/** Clear the session cookie. */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/', ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}) })
}

/** Verify a JWT string and return its payload, or null if invalid/expired. */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as SessionPayload & { iat: number; exp: number }
    if (!decoded.userId) return null
    return { userId: decoded.userId }
  } catch {
    return null
  }
}

/**
 * Resolve the current user + their first account membership from the session cookie.
 * Attaches `request.user`, `request.account`, `request.role` if valid.
 * Refreshes the cookie (rolling expiry) when a valid session is found.
 */
async function attachSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = (request as unknown as { cookies?: Record<string, string | undefined> }).cookies?.[COOKIE_NAME]
  if (!token) return
  const payload = verifySessionToken(token)
  if (!payload) return

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      memberships: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        include: { client: true },
      },
    },
  })
  if (!user) return

  request.user = { id: user.id, email: user.email, name: user.name }
  // Resolves first ClientMembership for now; a multi-client switcher comes later.
  // The request field is named `account` for backward-compat with /login/me's
  // public response shape — internally it carries the Client (post-merger).
  const m = user.memberships[0]
  if (m) {
    request.account = { id: m.client.id, name: m.client.companyName }
    request.role = m.role
  }

  // Rolling expiry: re-issue the cookie so the 30-day window slides forward.
  setSessionCookie(reply, user.id)
}

// Wrapped with fastify-plugin so the onRequest hook escapes encapsulation
// and applies to sibling-registered routes (loginRoutes, billingRoutes, etc).
// Without fp, the hook only fires for routes registered as children of this
// plugin — which is none — and every authenticated request 401s silently.
export const sessionPlugin = fp(async (app: FastifyInstance) => {
  if (!app.hasPlugin?.('@fastify/cookie')) {
    await app.register(fastifyCookie)
  }
  app.addHook('onRequest', attachSession)
}, { name: 'session-plugin' })

/**
 * preHandler that 401s if there is no authenticated user.
 *
 * Usage:
 *   app.get('/something', { preHandler: requireAuth }, async (req) => { ... req.user! ... })
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    return reply.code(401).send({ error: 'unauthorized' })
  }
}
