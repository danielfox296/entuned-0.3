// POST /admin/free-tier-imports — bulk-ingest externally-produced instrumental
// MP3s straight into the free-tier pool.
//
// These tracks were produced outside the generation pipeline (no Hook, no
// SongSeed, no ReferenceTrack, no tempo/arrangement metadata). The playback
// path (lib/hendrix.ts) selects purely on (icpId, outcomeId, active) and never
// reads per-song musical metadata, so a track is fully playable as just two
// rows: a Song (R2 audio) and a LineageRow pointing at FREE_TIER_ICP_ID.
//
// This is the same two-row shape that POST /admin/lineage-rows/:id/toggle-general
// writes when an operator checks "free tier" on a library song — except here
// there is no source LineageRow to copy from, so we create both rows directly.
// We deliberately reuse FREE_TIER_ICP_ID rather than minting a new ICP: free
// stores resolve their pool through StoreICP → FREE_TIER_ICP_ID, so that is the
// only attribution that actually plays.
//
// Idempotency: the R2 object key is content-addressed (sha256 of the bytes), so
// re-running a partially-failed batch upserts the same Song instead of
// duplicating audio, and the LineageRow is only created if an active one for
// (songId, outcomeId, FREE_TIER_ICP_ID) doesn't already exist.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { verify } from '../lib/auth.js'
import { uploadBuffer, MIN_AUDIO_BYTES } from '../lib/r2.js'
import { FREE_TIER_ICP_ID } from '../lib/freeTier.js'

interface AuthedOp { accountId: string; email: string; isAdmin: boolean }

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthedOp | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { reply.code(401).send({ error: 'unauthorized' }); return null }
  const payload = verify(auth.slice(7))
  if (!payload) { reply.code(401).send({ error: 'invalid_token' }); return null }
  if (!payload.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
  const op = await prisma.account.findUnique({ where: { id: payload.accountId } })
  if (!op || op.disabledAt || !op.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
  if (op.tokenVersion !== payload.tv) { reply.code(401).send({ error: 'token_revoked' }); return null }
  return { accountId: op.id, email: op.email, isAdmin: op.isAdmin }
}

export const adminImportRoutes: FastifyPluginAsync = async (app) => {
  // POST /admin/free-tier-imports?outcome=<title|displayTitle>
  // multipart body: exactly one audio file field.
  // Resolves the outcome by name (case-insensitive title or displayTitle),
  // asserts it's in the FreeTierOutcome allowlist, then upserts Song +
  // LineageRow @ FREE_TIER_ICP_ID.
  app.post('/free-tier-imports', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return

    const outcomeName = (req.query as Record<string, string>).outcome?.trim()
    if (!outcomeName) {
      return reply.code(400).send({ error: 'missing_outcome', message: 'Pass ?outcome=<name> (e.g. chill, steady, upbeat).' })
    }

    // Resolve outcome by title OR displayTitle, newest version first. Matching
    // mirrors pickSystemDefaultOutcomeId's name resolution in lib/outcomes.ts.
    const outcome = await prisma.outcome.findFirst({
      where: {
        supersededAt: null,
        OR: [
          { title: { equals: outcomeName, mode: 'insensitive' } },
          { displayTitle: { equals: outcomeName, mode: 'insensitive' } },
        ],
      },
      select: { id: true, outcomeKey: true, version: true, title: true },
      orderBy: { version: 'desc' },
    })
    if (!outcome) {
      return reply.code(404).send({ error: 'outcome_not_found', message: `No active outcome named "${outcomeName}".` })
    }

    // Hard free-tier invariant: a track can only enter the free pool under an
    // outcome that's in the FreeTierOutcome allowlist. Same guard the store
    // outcome-selection and default-picker paths enforce.
    const allowed = await prisma.freeTierOutcome.findUnique({ where: { outcomeKey: outcome.outcomeKey } })
    if (!allowed) {
      return reply.code(409).send({
        error: 'outcome_not_in_free_tier_allowlist',
        message: `Outcome "${outcome.title}" is not in the free-tier allowlist.`,
      })
    }

    // Read the single uploaded file.
    let part: Awaited<ReturnType<FastifyRequest['file']>>
    try {
      part = await req.file()
    } catch (e: any) {
      return reply.code(400).send({ error: 'bad_multipart', message: e?.message ?? 'unknown' })
    }
    if (!part) return reply.code(400).send({ error: 'no_file', message: 'Attach one audio file.' })

    const buf = await part.toBuffer()

    // Integrity guards — same byte floor the Suno accept path uses, so a 0-byte
    // / partial / non-audio upload can never enter the pool.
    if (buf.length < MIN_AUDIO_BYTES) {
      return reply.code(400).send({ error: 'file_too_small', message: `File is ${buf.length} bytes, below the ${MIN_AUDIO_BYTES}-byte floor.` })
    }
    if (buf[0] === 0x3c) {
      return reply.code(400).send({ error: 'not_audio', message: 'File looks like HTML/XML, not audio.' })
    }
    const mimeOk = !part.mimetype || /^(audio|application\/octet-stream)/i.test(part.mimetype)
    if (!mimeOk) {
      return reply.code(400).send({ error: 'not_audio', message: `Unexpected content-type ${part.mimetype}.` })
    }

    // Content-addressed key → idempotent re-uploads of the same bytes.
    const sha = createHash('sha256').update(buf).digest('hex')
    const key = `free-tier-imports/${outcome.title.toLowerCase()}/${sha}.mp3`

    let obj
    try {
      obj = await uploadBuffer(key, buf, 'audio/mpeg')
    } catch (e: any) {
      return reply.code(502).send({ error: 'r2_upload_failed', message: e?.message ?? 'unknown' })
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const song = await tx.song.upsert({
          where: { r2Url: obj.url },
          create: {
            r2Url: obj.url,
            r2ObjectKey: obj.key,
            byteSize: BigInt(obj.byteSize),
            contentType: obj.contentType,
            engine: 'import',
          },
          update: {},
        })

        const existingRow = await tx.lineageRow.findFirst({
          where: { songId: song.id, outcomeId: outcome.id, icpId: FREE_TIER_ICP_ID, active: true },
          select: { id: true },
        })
        if (existingRow) {
          return { songId: song.id, lineageRowId: existingRow.id, r2Url: obj.url, deduped: true }
        }

        const row = await tx.lineageRow.create({
          data: {
            songId: song.id,
            r2Url: obj.url,
            icpId: FREE_TIER_ICP_ID,
            outcomeId: outcome.id,
            outcomeVersion: outcome.version,
            hookId: null,
            songSeedId: null,
            active: true,
          },
        })
        return { songId: song.id, lineageRowId: row.id, r2Url: obj.url, deduped: false }
      })
      return result
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        return reply.code(409).send({ error: 'db_conflict', message: e.message })
      }
      return reply.code(500).send({ error: 'import_failed', message: e?.message ?? 'unknown' })
    }
  })
}
