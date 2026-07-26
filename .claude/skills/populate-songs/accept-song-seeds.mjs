// Mirrors POST /admin/song-seeds/:id/accept (apps/server/src/routes/admin.ts).
//
// Why this exists: Chrome MCP masks the admin bearer — `localStorage.getItem
// ('entuned.admin.token')` returns the literal string `[BLOCKED: JWT token]`,
// deterministically, on every run. The HTTP accept path is therefore NOT
// available from a browser-driven run, and this script is the primary path,
// not a fallback. See SKILL.md Step 8 and memory `feedback_chrome_mcp_jwt_filter`.
//
// Usage (from the monorepo root):
//   B64=$(base64 < .claude/skills/populate-songs/accept-song-seeds.mjs | tr -d '\n')
//   J=$(base64 < /tmp/wave.json | tr -d '\n')
//   railway ssh "cd /app && echo '$B64' | base64 -d > _accept-seeds.mjs \
//     && node --import tsx _accept-seeds.mjs '$J' && rm -f _accept-seeds.mjs"
//
// /tmp/wave.json shape: [{ "seedId": "...", "urls": ["https://suno.com/song/<uuid>", ...] }]
//
// KEEP IN SYNC with the route. If the accept transaction changes (new column,
// new side effect), update both. Drift here is silent — it writes rows that
// look right and differ from what the browser path would have written.
import { PrismaClient } from '@prisma/client'
const { downloadAndUploadFromUrl } = await import('file:///app/dist/lib/r2.js')

// Suno's own audio-integrity floor lets truncated renders through: a failed
// generation ("Credits Refunded" in the workspace) yields a 2-8 second clip of
// ~57KB that uploads cleanly. Healthy takes are 1.5-5MB. Refuse anything small
// rather than publish a 2-second song to the free tier.
const MIN_BYTES = 500_000

const prisma = new PrismaClient()
const jobs = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf-8'))
const report = []

for (const { seedId, urls } of jobs) {
  try {
    const existing = await prisma.songSeed.findUnique({ where: { id: seedId } })
    if (!existing) { report.push({ seedId, ok: false, error: 'not_found' }); continue }
    if (existing.status !== 'queued') { report.push({ seedId, ok: false, error: `not_queued:${existing.status}` }); continue }

    const uploaded = []
    for (let i = 0; i < urls.length; i++) {
      const key = `song-seeds/${seedId}/take-${i + 1}-${Date.now()}.mp3`
      uploaded.push(await downloadAndUploadFromUrl(urls[i], key))
    }
    const runt = uploaded.find((o) => o.byteSize < MIN_BYTES)
    if (runt) {
      // Leave the seed queued so it can be re-fired once Suno renders properly.
      report.push({ seedId, ok: false, error: `truncated_take_${runt.byteSize}b` })
      continue
    }

    const outcome = await prisma.outcome.findUnique({ where: { id: existing.outcomeId }, select: { version: true } })
    const lineage = await prisma.$transaction(async (tx) => {
      const rows = []
      for (const obj of uploaded) {
        const song = await tx.song.upsert({
          where: { r2Url: obj.url },
          create: {
            r2Url: obj.url,
            r2ObjectKey: obj.key,
            byteSize: BigInt(obj.byteSize),
            contentType: obj.contentType,
            engine: existing.engine,
          },
          update: {},
        })
        rows.push(await tx.lineageRow.create({
          data: {
            songId: song.id,
            r2Url: obj.url,
            icpId: existing.icpId,
            outcomeId: existing.outcomeId,
            outcomeVersion: outcome?.version ?? null,
            hookId: existing.hookId,
            songSeedId: existing.id,
            active: true,
          },
        }))
      }
      await tx.songSeed.update({ where: { id: seedId }, data: { status: 'accepted', terminalAt: new Date() } })
      if (existing.referenceTrackId) {
        await tx.referenceTrack.update({ where: { id: existing.referenceTrackId }, data: { useCount: { increment: 1 } } })
      }
      await tx.hook.update({ where: { id: existing.hookId }, data: { useCount: { increment: 1 } } })
      return rows
    })
    report.push({ seedId, ok: true, bytes: uploaded.map((o) => o.byteSize), r2: lineage.map((r) => r.r2Url) })
  } catch (e) {
    report.push({ seedId, ok: false, error: String(e.message || e).slice(0, 240) })
  }
}

console.log('ACCEPTREPORT' + JSON.stringify(report) + 'ENDREPORT')
process.exit(0)
