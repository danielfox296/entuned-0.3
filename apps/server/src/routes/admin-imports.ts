// POST /admin/free-tier-imports — bulk-ingest externally-produced instrumental
// MP3s straight into a free-tier pool.
//
// These tracks were produced outside the generation pipeline (no Hook, no
// SongSeed, no ReferenceTrack, no tempo/arrangement metadata). The playback
// path (lib/hendrix.ts) selects purely on (icpId, outcomeId, active) and never
// reads per-song musical metadata, so a track is fully playable as just two
// rows: a Song (R2 audio) and a LineageRow pointing at the target ICP.
//
// This is the same two-row shape that POST /admin/lineage-rows/:id/toggle-general
// writes when an operator checks "free tier" on a library song — except here
// there is no source LineageRow to copy from, so we create both rows directly.
//
// Two targets, selected by the optional `?station=` param:
//
//   absent   → FREE_TIER_ICP_ID, the canonical free pool every free Store falls
//              back to. This is the original behaviour and stays the default.
//   present  → that Station's own ICP (Card 23). A Station's pool IS its ICP's
//              LineageRow set, so importing at station.icpId is the whole of
//              what "populate this station" means — there is no LineageRow.
//              stationId and no second pool mechanism.
//
// Station targeting exists because manually-produced station libraries have no
// other way in: the only other LineageRow writers are toggle-general (hardcoded
// to FREE_TIER_ICP_ID) and the accept-takes path (which derives its icpId from a
// SongSeed, i.e. the generation pipeline). Without this param a manual track can
// only land in the sentinel pool, where it would play on every station at once
// and none of them specifically.
//
// Inactive stations are accepted on purpose: pre-loading a station's pool before
// flipping it live is the launch workflow. `active` comes back in the response so
// the operator can see what they're writing into.
//
// Idempotency: the R2 object key is content-addressed (sha256 of the bytes), so
// re-running a partially-failed batch upserts the same Song instead of
// duplicating audio, and the LineageRow is only created if an active one for
// (songId, outcomeId, targetIcpId) doesn't already exist. The key deliberately
// does NOT include the station — identical bytes on two stations should be one
// Song with two LineageRows, which is the same shape toggle-general produces.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { adminPreHandler, ensureOperatorDecorator } from '../lib/auth.js'
import { uploadBuffer, MIN_AUDIO_BYTES } from '../lib/r2.js'
import { FREE_TIER_ICP_ID } from '../lib/freeTier.js'

export const adminImportRoutes: FastifyPluginAsync = async (app) => {
  ensureOperatorDecorator(app)
  app.addHook('preHandler', adminPreHandler)

  // POST /admin/free-tier-imports?outcome=<title|displayTitle>[&station=<stationKey>]
  // multipart body: exactly one audio file field.
  // Resolves the outcome by name (case-insensitive title or displayTitle),
  // asserts it's in the FreeTierOutcome allowlist, resolves the target ICP
  // (a Station's ICP, or the sentinel), then upserts Song + LineageRow.
  app.post('/free-tier-imports', async (req, reply) => {
    const query = req.query as Record<string, string>
    const outcomeName = query.outcome?.trim()
    if (!outcomeName) {
      return reply.code(400).send({ error: 'missing_outcome', message: 'Pass ?outcome=<name> (e.g. dwell).' })
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

    // Resolve the target pool. No ?station= keeps the original sentinel
    // behaviour; a stationKey redirects the LineageRow to that Station's ICP.
    // Resolved BEFORE the upload so a typo'd key fails without burning R2.
    let targetIcpId = FREE_TIER_ICP_ID
    let station: { stationKey: string; displayName: string; active: boolean } | null = null
    const stationKey = query.station?.trim()
    if (stationKey) {
      const found = await prisma.station.findUnique({
        where: { stationKey },
        select: { icpId: true, stationKey: true, displayName: true, active: true },
      })
      if (!found) {
        // Fail loudly with the candidate list rather than silently importing
        // into the sentinel — a typo'd station must never quietly become a
        // write to the pool every free Store reads.
        const all = await prisma.station.findMany({
          select: { stationKey: true },
          orderBy: { sortOrder: 'asc' },
        })
        return reply.code(404).send({
          error: 'station_not_found',
          message: `No station with key "${stationKey}".`,
          candidates: all.map((s) => s.stationKey),
        })
      }
      targetIcpId = found.icpId
      station = { stationKey: found.stationKey, displayName: found.displayName, active: found.active }
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
          where: { songId: song.id, outcomeId: outcome.id, icpId: targetIcpId, active: true },
          select: { id: true },
        })
        if (existingRow) {
          return { songId: song.id, lineageRowId: existingRow.id, r2Url: obj.url, deduped: true, icpId: targetIcpId, station }
        }

        const row = await tx.lineageRow.create({
          data: {
            songId: song.id,
            r2Url: obj.url,
            icpId: targetIcpId,
            outcomeId: outcome.id,
            outcomeVersion: outcome.version,
            hookId: null,
            songSeedId: null,
            active: true,
          },
        })
        return { songId: song.id, lineageRowId: row.id, r2Url: obj.url, deduped: false, icpId: targetIcpId, station }
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
