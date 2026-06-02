// Integration tests for the Song Repair admin surface.
//
// Routes covered:
//   GET  /admin/songs/broken           — list active songs with <50KB audio
//   POST /admin/songs/:id/repair       — re-download from sourceUrl + overwrite r2 object
//   POST /admin/songs/:id/repair-file  — multipart mp3 upload + overwrite r2 object
//
// Lives in its own file so the prisma mock surface stays scoped to the
// models these routes touch (Song, LineageRow via include, Account for
// requireAdmin). Mirrors the auth + buildTestApp conventions in
// admin.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const mock: any = {
    account: { findUnique: vi.fn() },
    song: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    // Required for adminRoutes to register — handlers we don't exercise
    // here still get attached, so all referenced models must exist.
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    scheduleSlot: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    client: { findUnique: vi.fn() },
    clientMembership: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mock)),
  }
  return { prisma: mock }
})

// The shared admin guard (adminPreHandler → requireAdmin) lives in lib/auth.js.
// Re-implement it here against the mocked verify + mocked prisma so the
// adminRoutes plugin's preHandler runs the real auth contract.
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

vi.mock('../lib/outcomes.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/outcomes.js')>('../lib/outcomes.js')
  return { ...actual, isFreeTierAllowedOutcome: vi.fn(async () => true) }
})

vi.mock('../lib/r2.js', () => ({
  downloadAndUploadFromUrl: vi.fn(),
  uploadBuffer: vi.fn(),
  MIN_AUDIO_BYTES: 50_000,
}))

import { adminRoutes } from './admin.js'
import { prisma } from '../db.js'
import { downloadAndUploadFromUrl, uploadBuffer } from '../lib/r2.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const songFindMany = prisma.song.findMany as ReturnType<typeof vi.fn>
const songFindUnique = prisma.song.findUnique as ReturnType<typeof vi.fn>
const songUpdate = prisma.song.update as ReturnType<typeof vi.fn>
const downloadMock = downloadAndUploadFromUrl as ReturnType<typeof vi.fn>
const uploadMock = uploadBuffer as ReturnType<typeof vi.fn>

const AUTH = { authorization: 'Bearer admin-test-token' }
const SONG_ID = 'song-00000000-0000-0000-0000-000000000001'

function seedAdminAccount() {
  accountFindUnique.mockResolvedValue({
    id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
  })
}

describe('admin routes — song repair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedAdminAccount()
  })

  describe('GET /songs/broken', () => {
    it('returns active songs under the byte floor with title + icp metadata flattened', async () => {
      songFindMany.mockResolvedValue([
        {
          id: SONG_ID,
          r2Url: 'https://pub-test.r2.dev/song-seeds/abc/take-1.mp3',
          r2ObjectKey: 'song-seeds/abc/take-1.mp3',
          byteSize: 0n,
          uploadedAt: new Date('2026-05-25T00:43:00Z'),
          lineageRows: [
            {
              id: 'lr-1',
              icpId: 'icp-1',
              icp: { name: 'Free Tier' },
              songSeed: { id: 'seed-1', title: 'Past the Porch Light' },
            },
            {
              id: 'lr-2',
              icpId: 'icp-1',
              icp: { name: 'Free Tier' },
              songSeed: { id: 'seed-1', title: 'Past the Porch Light' },
            },
          ],
        },
      ])

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({ method: 'GET', url: '/songs/broken', headers: AUTH })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        songId: SONG_ID,
        r2Url: 'https://pub-test.r2.dev/song-seeds/abc/take-1.mp3',
        r2ObjectKey: 'song-seeds/abc/take-1.mp3',
        byteSize: 0,
        title: 'Past the Porch Light',
        songSeedId: 'seed-1',
        icpId: 'icp-1',
        icpName: 'Free Tier',
        lineageRowIds: ['lr-1', 'lr-2'],
      })
      // Filter shape: byteSize floor + at-least-one-active-lineage.
      expect(songFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { byteSize: { lt: 50_000n }, lineageRows: { some: { active: true } } },
        }),
      )
    })

    it('returns 401 without an Authorization header', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({ method: 'GET', url: '/songs/broken' })
      expect(res.statusCode).toBe(401)
      expect(songFindMany).not.toHaveBeenCalled()
    })
  })

  describe('POST /songs/:id/repair', () => {
    it('overwrites the existing r2ObjectKey and updates Song byte size + content type', async () => {
      songFindUnique.mockResolvedValue({ id: SONG_ID, r2ObjectKey: 'song-seeds/abc/take-1.mp3' })
      downloadMock.mockResolvedValue({
        url: 'https://pub-test.r2.dev/song-seeds/abc/take-1.mp3',
        key: 'song-seeds/abc/take-1.mp3',
        byteSize: 3_800_000,
        contentType: 'audio/mpeg',
      })
      songUpdate.mockResolvedValue({
        id: SONG_ID,
        r2Url: 'https://pub-test.r2.dev/song-seeds/abc/take-1.mp3',
        r2ObjectKey: 'song-seeds/abc/take-1.mp3',
        byteSize: 3_800_000n,
        contentType: 'audio/mpeg',
        uploadedAt: new Date('2026-05-25T02:00:00Z'),
      })

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/songs/${SONG_ID}/repair`,
        headers: { ...AUTH, 'content-type': 'application/json' },
        payload: { sourceUrl: 'https://suno.com/song/abc' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: SONG_ID, byteSize: 3_800_000, contentType: 'audio/mpeg' })
      // The repair MUST reuse the existing object key — that's what keeps
      // every existing LineageRow.r2Url + play-history pointer valid.
      expect(downloadMock).toHaveBeenCalledWith('https://suno.com/song/abc', 'song-seeds/abc/take-1.mp3')
      expect(songUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SONG_ID },
          data: expect.objectContaining({ byteSize: 3_800_000n, contentType: 'audio/mpeg' }),
        }),
      )
    })

    it('returns 404 when the Song does not exist', async () => {
      songFindUnique.mockResolvedValue(null)
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/songs/${SONG_ID}/repair`,
        headers: { ...AUTH, 'content-type': 'application/json' },
        payload: { sourceUrl: 'https://suno.com/song/abc' },
      })
      expect(res.statusCode).toBe(404)
      expect(downloadMock).not.toHaveBeenCalled()
      expect(songUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 on bad body (sourceUrl missing / not a URL)', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/songs/${SONG_ID}/repair`,
        headers: { ...AUTH, 'content-type': 'application/json' },
        payload: { sourceUrl: 'not-a-url' },
      })
      expect(res.statusCode).toBe(400)
      expect(songFindUnique).not.toHaveBeenCalled()
    })

    it('returns 502 r2_upload_failed when the r2 guard rejects (e.g. still-rendering Suno take)', async () => {
      songFindUnique.mockResolvedValue({ id: SONG_ID, r2ObjectKey: 'song-seeds/abc/take-1.mp3' })
      downloadMock.mockRejectedValue(new Error('content-length 0 below 50000-byte floor — source may still be rendering'))

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/songs/${SONG_ID}/repair`,
        headers: { ...AUTH, 'content-type': 'application/json' },
        payload: { sourceUrl: 'https://suno.com/song/abc' },
      })
      expect(res.statusCode).toBe(502)
      expect(res.json()).toMatchObject({ error: 'r2_upload_failed' })
      // CRITICAL: when the guard fires we MUST NOT touch the Song row —
      // the existing (possibly-good) r2 object stays untouched.
      expect(songUpdate).not.toHaveBeenCalled()
    })
  })
})
