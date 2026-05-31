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
    song: { upsert: vi.fn() },
    lineageRow: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mock)),
  }
  return { prisma: mock }
})

vi.mock('../lib/auth.js', () => ({
  verify: vi.fn((token: string) => {
    if (token === 'admin-test-token') {
      return { accountId: 'op-admin-001', email: 'admin@example.com', isAdmin: true, tv: 7, exp: Date.now() + 60_000 }
    }
    return null
  }),
}))

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
})
