// Integration tests for the free-tier bulk-import surface:
//   POST /admin/free-tier-imports?outcome=<name>
//
// Covers: auth, outcome resolution, the free-tier allowlist guard, audio
// integrity floor, the happy-path two-row insert (Song + LineageRow @
// FREE_TIER_ICP_ID, no hook/seed), and idempotent re-POST of the same bytes.
//
// The route reads its file via req.file(), so this suite registers
// @fastify/multipart on the test app (buildTestApp doesn't) and hand-builds a
// multipart body with a fixed boundary — no reliance on the undeclared
// transitive `form-data` package.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const mock: any = {
    account: { findUnique: vi.fn() },
    outcome: { findFirst: vi.fn() },
    freeTierOutcome: { findUnique: vi.fn() },
    station: { findUnique: vi.fn(), findMany: vi.fn() },
    song: { upsert: vi.fn() },
    lineageRow: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mock)),
  }
  return { prisma: mock }
})

// The shared admin guard (adminPreHandler → requireAdmin) lives in lib/auth.js.
// Re-implement it here against the mocked verify + mocked prisma so the route's
// preHandler runs the real auth contract without real HMAC tokens.
vi.mock('../lib/auth.js', () => {
  const verify = vi.fn((token: string) => {
    if (token === 'admin-test-token') {
      return { accountId: 'op-admin-001', email: 'admin@example.com', isAdmin: true, tv: 7, exp: Date.now() + 60_000 }
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

vi.mock('../lib/r2.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/r2.js')>('../lib/r2.js')
  return {
    ...actual,
    uploadBuffer: vi.fn(async (key: string, body: Buffer, contentType: string) => ({
      key,
      url: `https://pub-test.r2.dev/${key}`,
      byteSize: body.length,
      contentType,
    })),
  }
})

import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { adminImportRoutes } from './admin-imports.js'
import { prisma } from '../db.js'
import { uploadBuffer, MIN_AUDIO_BYTES } from '../lib/r2.js'
import { FREE_TIER_ICP_ID } from '../lib/freeTier.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const outcomeFindFirst = prisma.outcome.findFirst as ReturnType<typeof vi.fn>
const freeTierFindUnique = prisma.freeTierOutcome.findUnique as ReturnType<typeof vi.fn>
const stationFindUnique = prisma.station.findUnique as ReturnType<typeof vi.fn>
const stationFindMany = prisma.station.findMany as ReturnType<typeof vi.fn>
const songUpsert = prisma.song.upsert as ReturnType<typeof vi.fn>
const lineageFindFirst = prisma.lineageRow.findFirst as ReturnType<typeof vi.fn>
const lineageCreate = prisma.lineageRow.create as ReturnType<typeof vi.fn>
const uploadBufferMock = uploadBuffer as ReturnType<typeof vi.fn>

const AUTH = { authorization: 'Bearer admin-test-token' }
const BOUNDARY = 'testboundary12345'

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
  await app.register(adminImportRoutes, { prefix: '/admin' })
  await app.ready()
  return app
}

// Build a minimal multipart/form-data body carrying one file field.
function multipartBody(filename: string, contentType: string, fileBytes: Buffer): Buffer {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`)
  return Buffer.concat([head, fileBytes, tail])
}

function inject(app: FastifyInstance, query: string, body: Buffer, headers: Record<string, string> = AUTH) {
  return app.inject({
    method: 'POST',
    url: `/admin/free-tier-imports${query}`,
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: body,
  })
}

const GOOD_AUDIO = Buffer.alloc(MIN_AUDIO_BYTES + 1000, 1) // passes the byte floor
const CHILL_OUTCOME = { id: 'oc-chill', outcomeKey: 'key-chill', version: 3, title: 'Chill' }
const JAZZ_STATION = {
  icpId: '00000000-0000-0000-0000-000000000106',
  stationKey: 'jazz-trio',
  displayName: 'Jazz Trio',
  active: true,
}

function seedAdminAccount() {
  accountFindUnique.mockResolvedValue({
    id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seedAdminAccount()
  outcomeFindFirst.mockResolvedValue(CHILL_OUTCOME)
  freeTierFindUnique.mockResolvedValue({ outcomeKey: 'key-chill' })
  stationFindUnique.mockResolvedValue(JAZZ_STATION)
  stationFindMany.mockResolvedValue([{ stationKey: 'solo-piano' }, { stationKey: 'jazz-trio' }])
  songUpsert.mockResolvedValue({ id: 'song-1' })
  lineageFindFirst.mockResolvedValue(null)
  lineageCreate.mockResolvedValue({ id: 'row-1' })
})

describe('POST /admin/free-tier-imports', () => {
  it('rejects unauthenticated requests without uploading or writing rows', async () => {
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO), {})
    // The auth guard (requireAdmin) replies before the multipart body is read,
    // so Fastify rejects the unconsumed stream with a 4xx — same shape as the
    // existing /admin/song-seeds/:id/accept-files route. The security contract
    // is what matters: rejected, no R2 upload, no DB write.
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
    expect(uploadBufferMock).not.toHaveBeenCalled()
    expect(lineageCreate).not.toHaveBeenCalled()
  })

  it('400s when no outcome query param is given', async () => {
    const app = await buildApp()
    const res = await inject(app, '', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('missing_outcome')
  })

  it('404s when the outcome name resolves to nothing', async () => {
    outcomeFindFirst.mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await inject(app, '?outcome=nope', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('outcome_not_found')
  })

  it('409s when the resolved outcome is not in the free-tier allowlist', async () => {
    freeTierFindUnique.mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('outcome_not_in_free_tier_allowlist')
    expect(uploadBufferMock).not.toHaveBeenCalled()
  })

  it('rejects a file below the audio byte floor before touching R2', async () => {
    const app = await buildApp()
    const tiny = Buffer.alloc(100, 1)
    const res = await inject(app, '?outcome=chill', multipartBody('a.mp3', 'audio/mpeg', tiny))
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('file_too_small')
    expect(uploadBufferMock).not.toHaveBeenCalled()
    expect(lineageCreate).not.toHaveBeenCalled()
  })

  it('happy path: uploads to R2 and creates Song + LineageRow @ FREE_TIER_ICP_ID with no hook/seed', async () => {
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.deduped).toBe(false)
    expect(body.songId).toBe('song-1')
    expect(body.lineageRowId).toBe('row-1')

    // Content-addressed key under the outcome folder.
    expect(uploadBufferMock).toHaveBeenCalledTimes(1)
    const [key, , ct] = uploadBufferMock.mock.calls[0]
    expect(key).toMatch(/^free-tier-imports\/chill\/[0-9a-f]{64}\.mp3$/)
    expect(ct).toBe('audio/mpeg')

    // LineageRow attribution is exactly the free-tier two-row shape.
    expect(lineageCreate).toHaveBeenCalledTimes(1)
    expect(lineageCreate.mock.calls[0][0].data).toMatchObject({
      songId: 'song-1',
      icpId: FREE_TIER_ICP_ID,
      outcomeId: 'oc-chill',
      outcomeVersion: 3,
      hookId: null,
      songSeedId: null,
      active: true,
    })

    // Song stamped with the 'import' engine for provenance.
    expect(songUpsert.mock.calls[0][0].create).toMatchObject({ engine: 'import' })
  })

  it('idempotent re-POST: an existing active row short-circuits without a second LineageRow', async () => {
    lineageFindFirst.mockResolvedValueOnce({ id: 'row-existing' })
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ deduped: true, lineageRowId: 'row-existing' })
    expect(lineageCreate).not.toHaveBeenCalled()
  })

  it('the same bytes produce the same content-addressed R2 key (dedupe key stability)', async () => {
    const app = await buildApp()
    await inject(app, '?outcome=chill', multipartBody('first.mp3', 'audio/mpeg', GOOD_AUDIO))
    await inject(app, '?outcome=chill', multipartBody('second.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(uploadBufferMock.mock.calls[0][0]).toBe(uploadBufferMock.mock.calls[1][0])
  })

  it('no ?station= still targets the sentinel (default behaviour unchanged)', async () => {
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(200)
    expect(stationFindUnique).not.toHaveBeenCalled()
    expect(lineageCreate.mock.calls[0][0].data.icpId).toBe(FREE_TIER_ICP_ID)
    expect(res.json().station).toBeNull()
  })
})

describe('POST /admin/free-tier-imports?station=', () => {
  it('routes the LineageRow to the station ICP, not the sentinel', async () => {
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill&station=jazz-trio', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(200)

    expect(stationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stationKey: 'jazz-trio' } }),
    )
    // The whole point: attribution lands on the station's own ICP. A Station's
    // pool IS its ICP's LineageRow set, so this is what "populate it" means.
    expect(lineageCreate).toHaveBeenCalledTimes(1)
    expect(lineageCreate.mock.calls[0][0].data).toMatchObject({
      songId: 'song-1',
      icpId: JAZZ_STATION.icpId,
      outcomeId: 'oc-chill',
      outcomeVersion: 3,
      hookId: null,
      songSeedId: null,
      active: true,
    })
    expect(lineageCreate.mock.calls[0][0].data.icpId).not.toBe(FREE_TIER_ICP_ID)
    expect(res.json()).toMatchObject({ icpId: JAZZ_STATION.icpId, station: { stationKey: 'jazz-trio' } })
  })

  it('404s an unknown station key with the candidate list, before any R2 upload', async () => {
    stationFindUnique.mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill&station=jazz-trioo', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('station_not_found')
    expect(res.json().candidates).toEqual(['solo-piano', 'jazz-trio'])
    // A typo must not silently fall back to the sentinel — that pool is read by
    // every free Store, so a mistyped key would publish to all of them at once.
    expect(uploadBufferMock).not.toHaveBeenCalled()
    expect(lineageCreate).not.toHaveBeenCalled()
  })

  it('dedupe is scoped per station — the existing-row check keys on the station ICP', async () => {
    const app = await buildApp()
    await inject(app, '?outcome=chill&station=jazz-trio', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(lineageFindFirst.mock.calls[0][0].where).toMatchObject({
      outcomeId: 'oc-chill',
      icpId: JAZZ_STATION.icpId,
      active: true,
    })
  })

  it('the same bytes on two stations reuse one Song but write two LineageRows', async () => {
    const app = await buildApp()
    await inject(app, '?outcome=chill&station=jazz-trio', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    stationFindUnique.mockResolvedValueOnce({
      icpId: '00000000-0000-0000-0000-000000000101',
      stationKey: 'solo-piano',
      displayName: 'Solo Piano',
      active: true,
    })
    await inject(app, '?outcome=chill&station=solo-piano', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))

    // Identical bytes → identical content-addressed key → one Song upsert target.
    expect(uploadBufferMock.mock.calls[0][0]).toBe(uploadBufferMock.mock.calls[1][0])
    // But two distinct pools → two LineageRows. Same shape toggle-general produces.
    expect(lineageCreate).toHaveBeenCalledTimes(2)
    expect(lineageCreate.mock.calls[0][0].data.icpId).toBe('00000000-0000-0000-0000-000000000106')
    expect(lineageCreate.mock.calls[1][0].data.icpId).toBe('00000000-0000-0000-0000-000000000101')
  })

  it('accepts an inactive station so a pool can be pre-loaded before going live', async () => {
    stationFindUnique.mockResolvedValueOnce({ ...JAZZ_STATION, active: false })
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill&station=jazz-trio', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(200)
    expect(lineageCreate.mock.calls[0][0].data.icpId).toBe(JAZZ_STATION.icpId)
    // Surfaced, not blocked — the operator can see they wrote into a dark station.
    expect(res.json().station).toMatchObject({ active: false })
  })

  it('still enforces the free-tier allowlist for station imports', async () => {
    freeTierFindUnique.mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await inject(app, '?outcome=chill&station=jazz-trio', multipartBody('a.mp3', 'audio/mpeg', GOOD_AUDIO))
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('outcome_not_in_free_tier_allowlist')
    expect(lineageCreate).not.toHaveBeenCalled()
  })
})
