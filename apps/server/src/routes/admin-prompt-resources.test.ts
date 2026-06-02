// Characterization + equivalence tests for the admin "Prompts & Rules" CRUD
// surfaces that were de-duplicated into admin-resource-helpers.ts
// (registerVersionedText + registerModuleCrud).
//
// These routes had NO test coverage before the refactor. The assertions below
// were written to pin the EXACT pre-refactor behavior (response shapes, version
// /sortOrder math, create payloads, error envelopes) and must stay green across
// the factory extraction — that is the equivalence proof.
//
// Mocking mirrors admin.test.ts: vi.mock('../db.js') for the Prisma delegates,
// vi.mock('../lib/auth.js') for the admin guard, vi.mock('../lib/outcomes.js')
// to keep the free-tier lookup out of the Prisma surface.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const versioned = () => ({ findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() })
  const moduleDelegate = () => ({
    findMany: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })
  const mock: any = {
    account: { findUnique: vi.fn() },
    styleAnalyzerInstructions: versioned(),
    outcomeFactorPrompt: versioned(),
    referenceTrackPrompt: versioned(),
    lyricDraftPrompt: versioned(),
    hookDrafterPrompt: versioned(),
    professorPersona: versioned(),
    musicProfessorPersona: versioned(),
    bpmLookupPrompt: versioned(),
    styleAnchorPrompt: versioned(),
    professorModule: moduleDelegate(),
    musicProfessorModule: moduleDelegate(),
  }
  return { prisma: mock, default: mock }
})

// Admin guard — reimplemented against the mocked verify + prisma.account so the
// test's magic Bearer tokens resolve to a known admin. (Same shape as admin.test.ts.)
vi.mock('../lib/auth.js', () => {
  function verify(token: string): any {
    if (token === 'admin-test-token') {
      return { accountId: 'op-admin-001', email: 'admin@example.com', isAdmin: true, tv: 7, exp: Date.now() + 60_000 }
    }
    return null
  }
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

vi.mock('../lib/outcomes.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/outcomes.js')>('../lib/outcomes.js')
  return { ...actual, isFreeTierAllowedOutcome: vi.fn(async () => true) }
})

import { adminRoutes } from './admin.js'
import { prisma } from '../db.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const AUTH = { authorization: 'Bearer admin-test-token' }
const ADMIN_ID = 'op-admin-001'

function seedAdminAccount() {
  ;(prisma.account.findUnique as any).mockResolvedValue({
    id: ADMIN_ID, email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seedAdminAccount()
})

// ── Versioned-text resources (registerVersionedText) ────────────────────────
// Each row: the flat GET/POST pair. lyric-prompts (nested GET) is tested separately.
interface VCase {
  label: string
  getPath: string
  postPath: string
  modelKey: keyof typeof prisma
  field: 'rulesText' | 'templateText' | 'promptText'
}
const VERSIONED: VCase[] = [
  { label: 'musicological-rules',   getPath: '/musicological-rules',   postPath: '/musicological-rules',   modelKey: 'styleAnalyzerInstructions', field: 'rulesText' },
  { label: 'outcome-factor-prompt', getPath: '/outcome-factor-prompt', postPath: '/outcome-factor-prompt', modelKey: 'outcomeFactorPrompt',      field: 'templateText' },
  { label: 'reference-track-prompt',getPath: '/reference-track-prompt',postPath: '/reference-track-prompt',modelKey: 'referenceTrackPrompt',     field: 'templateText' },
  { label: 'hook-drafter-prompt',   getPath: '/hook-drafter-prompt',   postPath: '/hook-drafter-prompt',   modelKey: 'hookDrafterPrompt',         field: 'promptText' },
  { label: 'professor/persona',     getPath: '/professor/persona',     postPath: '/professor/persona',     modelKey: 'professorPersona',          field: 'promptText' },
  { label: 'music-professor/persona', getPath: '/music-professor/persona', postPath: '/music-professor/persona', modelKey: 'musicProfessorPersona', field: 'promptText' },
  { label: 'bpm-lookup-prompt',     getPath: '/bpm-lookup-prompt',     postPath: '/bpm-lookup-prompt',     modelKey: 'bpmLookupPrompt',           field: 'promptText' },
  { label: 'style-prompt',          getPath: '/style-prompt',          postPath: '/style-prompt',          modelKey: 'styleAnchorPrompt',         field: 'promptText' },
]

describe.each(VERSIONED)('admin versioned-text resource: $label', (c) => {
  const model = () => prisma[c.modelKey] as any

  it('GET returns { latest, history } newest-first', async () => {
    const r2 = { id: 'v2', version: 2 }
    const r1 = { id: 'v1', version: 1 }
    model().findMany.mockResolvedValue([r2, r1])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: c.getPath, headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ latest: r2, history: [r2, r1] })
    expect(model().findMany).toHaveBeenCalledWith({ orderBy: { version: 'desc' } })
  })

  it('GET with empty table returns latest: null', async () => {
    model().findMany.mockResolvedValue([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: c.getPath, headers: AUTH })
    expect(res.json()).toEqual({ latest: null, history: [] })
  })

  it('POST bumps version and persists with createdById', async () => {
    model().aggregate.mockResolvedValue({ _max: { version: 5 } })
    model().create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'POST', url: c.postPath, headers: AUTH, payload: { [c.field]: 'hello', notes: 'n' } })
    expect(res.statusCode).toBe(200)
    expect(model().create).toHaveBeenCalledWith({
      data: { version: 6, [c.field]: 'hello', notes: 'n', createdById: ADMIN_ID },
    })
  })

  it('POST on empty table starts at version 1 and nulls absent notes', async () => {
    model().aggregate.mockResolvedValue({ _max: { version: null } })
    model().create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }))
    const app = await buildTestApp(adminRoutes)
    await app.inject({ method: 'POST', url: c.postPath, headers: AUTH, payload: { [c.field]: 'x' } })
    expect(model().create).toHaveBeenCalledWith({
      data: { version: 1, [c.field]: 'x', notes: null, createdById: ADMIN_ID },
    })
  })

  it('POST with missing text field → 400 bad_body', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'POST', url: c.postPath, headers: AUTH, payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
  })

  it('GET without auth → 401', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: c.getPath })
    expect(res.statusCode).toBe(401)
  })
})

// ── lyric-prompts: nested GET shape + distinct POST path ─────────────────────
describe('admin versioned-text resource: lyric-prompts (nested)', () => {
  const model = () => prisma.lyricDraftPrompt as any

  it('GET /lyric-prompts wraps under { draft: { latest, history } }', async () => {
    const r2 = { id: 'v2', version: 2 }
    const r1 = { id: 'v1', version: 1 }
    model().findMany.mockResolvedValue([r2, r1])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/lyric-prompts', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ draft: { latest: r2, history: [r2, r1] } })
  })

  it('POST /lyric-prompts/draft bumps version with promptText', async () => {
    model().aggregate.mockResolvedValue({ _max: { version: 2 } })
    model().create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'POST', url: '/lyric-prompts/draft', headers: AUTH, payload: { promptText: 'lyr' } })
    expect(res.statusCode).toBe(200)
    expect(model().create).toHaveBeenCalledWith({
      data: { version: 3, promptText: 'lyr', notes: null, createdById: ADMIN_ID },
    })
  })
})

// ── Module CRUD (registerModuleCrud): professor vs music-professor ───────────
describe('admin module CRUD: professor/modules', () => {
  const model = () => prisma.professorModule as any

  it('GET lists ordered by sortOrder asc', async () => {
    const rows = [{ id: 'm1', sortOrder: 10 }, { id: 'm2', sortOrder: 20 }]
    model().findMany.mockResolvedValue(rows)
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/professor/modules', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(rows)
    expect(model().findMany).toHaveBeenCalledWith({ orderBy: { sortOrder: 'asc' } })
  })

  it('POST defaults sortOrder to max+10 and active true; no tier field', async () => {
    model().aggregate.mockResolvedValue({ _max: { sortOrder: 40 } })
    model().create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'POST', url: '/professor/modules', headers: AUTH, payload: { name: 'A', body: 'B' } })
    expect(res.statusCode).toBe(200)
    expect(model().create).toHaveBeenCalledWith({ data: { name: 'A', body: 'B', active: true, sortOrder: 50 } })
  })

  it('POST honors explicit sortOrder', async () => {
    model().aggregate.mockResolvedValue({ _max: { sortOrder: 40 } })
    model().create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }))
    const app = await buildTestApp(adminRoutes)
    await app.inject({ method: 'POST', url: '/professor/modules', headers: AUTH, payload: { name: 'A', body: 'B', sortOrder: 5 } })
    expect(model().create).toHaveBeenCalledWith({ data: { name: 'A', body: 'B', active: true, sortOrder: 5 } })
  })

  it('PATCH updates by id; missing → 404', async () => {
    model().update.mockResolvedValueOnce({ id: 'm1', name: 'X' })
    const app = await buildTestApp(adminRoutes)
    const ok = await app.inject({ method: 'PATCH', url: '/professor/modules/m1', headers: AUTH, payload: { name: 'X' } })
    expect(ok.statusCode).toBe(200)
    model().update.mockRejectedValueOnce(new Error('no row'))
    const miss = await app.inject({ method: 'PATCH', url: '/professor/modules/zzz', headers: AUTH, payload: { name: 'X' } })
    expect(miss.statusCode).toBe(404)
    expect(miss.json()).toEqual({ error: 'not_found' })
  })

  it('DELETE returns { ok: true }; missing → 404', async () => {
    model().delete.mockResolvedValueOnce({})
    const app = await buildTestApp(adminRoutes)
    const ok = await app.inject({ method: 'DELETE', url: '/professor/modules/m1', headers: AUTH })
    expect(ok.json()).toEqual({ ok: true })
    model().delete.mockRejectedValueOnce(new Error('no row'))
    const miss = await app.inject({ method: 'DELETE', url: '/professor/modules/zzz', headers: AUTH })
    expect(miss.statusCode).toBe(404)
  })

  it('POST bad body → 400', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'POST', url: '/professor/modules', headers: AUTH, payload: { name: '' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
  })
})

describe('admin module CRUD: music-professor/modules (adds tier)', () => {
  const model = () => prisma.musicProfessorModule as any

  it('POST defaults tier to "optional"', async () => {
    model().aggregate.mockResolvedValue({ _max: { sortOrder: 0 } })
    model().create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'POST', url: '/music-professor/modules', headers: AUTH, payload: { name: 'A', body: 'B' } })
    expect(res.statusCode).toBe(200)
    expect(model().create).toHaveBeenCalledWith({ data: { name: 'A', body: 'B', active: true, sortOrder: 10, tier: 'optional' } })
  })

  it('POST honors explicit tier', async () => {
    model().aggregate.mockResolvedValue({ _max: { sortOrder: 0 } })
    model().create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }))
    const app = await buildTestApp(adminRoutes)
    await app.inject({ method: 'POST', url: '/music-professor/modules', headers: AUTH, payload: { name: 'A', body: 'B', tier: 'core' } })
    expect(model().create).toHaveBeenCalledWith({ data: { name: 'A', body: 'B', active: true, sortOrder: 10, tier: 'core' } })
  })
})
