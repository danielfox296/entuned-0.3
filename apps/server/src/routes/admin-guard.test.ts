// Cross-group regression for the shared admin auth guard (lib/auth.ts).
//
// Audit item #2: `requireAdmin` was copy-pasted into four admin route plugins
// and had DRIFTED — admin-reliability returned { error: 'forbidden' } where the
// others returned { error: 'admin_required' }. It's now a single shared guard
// (requireAdmin + adminPreHandler) registered as a plugin-scope preHandler on
// every admin plugin.
//
// This suite pins the contract uniformly across all four plugins:
//   - no Bearer header                → 401 { error: 'unauthorized' }
//   - valid token, operator not admin → 403 { error: 'admin_required' }
//
// The 403 case is the drift-fix: admin-reliability must now reply
// 'admin_required', not the legacy 'forbidden'.
//
// Rejection happens in the preHandler before any DB/business logic, so the
// Prisma mock only needs `account.findUnique` to exist (the non-admin path
// short-circuits before it is even called).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    account: { findUnique: vi.fn() },
  },
}))

// Stub `verify` to recognise the two magic tokens, then re-implement the
// shared guard against that stub + the mocked prisma. Mirrors the mock used
// by admin.test.ts / admin-imports.test.ts so the auth contract is exercised
// through each plugin's real preHandler without real HMAC tokens.
vi.mock('../lib/auth.js', () => {
  const verify = vi.fn((token: string) => {
    if (token === 'admin-test-token') {
      return { accountId: 'op-admin-001', email: 'admin@example.com', isAdmin: true, tv: 7, exp: Date.now() + 60_000 }
    }
    if (token === 'non-admin-test-token') {
      return { accountId: 'op-user-002', email: 'user@example.com', isAdmin: false, tv: 1, exp: Date.now() + 60_000 }
    }
    return null
  })
  async function requireAdmin(req: any, reply: any) {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) { reply.code(401).send({ error: 'unauthorized' }); return null }
    const payload = verify(auth.slice(7))
    if (!payload) { reply.code(401).send({ error: 'invalid_token' }); return null }
    if (!payload.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
    const { prisma } = await import('../db.js')
    const op = await (prisma as any).account.findUnique({ where: { id: payload.accountId } })
    if (!op || op.disabledAt || !op.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
    if (op.tokenVersion !== payload.tv) { reply.code(401).send({ error: 'token_revoked' }); return null }
    return { accountId: op.id, email: op.email, isAdmin: op.isAdmin }
  }
  return {
    verify,
    requireAdmin,
    adminPreHandler: async (req: any, reply: any) => {
      const op = await requireAdmin(req, reply)
      if (!op) return reply
      req.operator = op
    },
    ensureOperatorDecorator: (app: any) => {
      if (!app.hasRequestDecorator('operator')) app.decorateRequest('operator', null)
    },
  }
})

import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import { adminRoutes } from './admin.js'
import { adminRetentionRoutes } from './admin-retention.js'
import { adminReliabilityRoutes } from './admin-reliability.js'
import { adminImportRoutes } from './admin-imports.js'

// One representative route per plugin. Method matters only insofar as it
// resolves to a registered route — the guard runs before the handler either
// way. All are mounted under /admin to mirror production.
const PLUGINS: Array<{ name: string; plugin: FastifyPluginAsync; method: 'GET' | 'POST'; url: string }> = [
  { name: 'admin', plugin: adminRoutes, method: 'GET', url: '/admin/musicological-rules' },
  { name: 'admin-retention', plugin: adminRetentionRoutes, method: 'GET', url: '/admin/retention' },
  { name: 'admin-reliability', plugin: adminReliabilityRoutes, method: 'GET', url: '/admin/reliability/summary' },
  { name: 'admin-imports', plugin: adminImportRoutes, method: 'POST', url: '/admin/free-tier-imports?outcome=chill' },
]

async function mount(plugin: FastifyPluginAsync): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(plugin, { prefix: '/admin' })
  await app.ready()
  return app
}

describe('shared admin guard — consistent rejection across admin route groups', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const { name, plugin, method, url } of PLUGINS) {
    it(`${name}: 401 { error: 'unauthorized' } when no Bearer header is sent`, async () => {
      const app = await mount(plugin)
      const res = await app.inject({ method, url })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    })

    it(`${name}: 403 { error: 'admin_required' } when the operator is not admin`, async () => {
      const app = await mount(plugin)
      const res = await app.inject({
        method,
        url,
        headers: { authorization: 'Bearer non-admin-test-token' },
      })
      expect(res.statusCode).toBe(403)
      // Drift-fix: admin-reliability previously returned 'forbidden' here.
      expect(res.json()).toEqual({ error: 'admin_required' })
    })
  }
})
