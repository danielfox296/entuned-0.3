// Replace the audio behind already-accepted LineageRows, in place.
//
// Use when a seed was accepted with truncated takes (Suno "Credits Refunded"
// failures render 2-8 second clips). The seed is already status='accepted' and
// the hook is consumed, so accept can't be re-run — but the LineageRows can be
// repointed at fresh audio, which keeps pool counts and attribution intact.
//
// Procedure:
//   1. Deactivate the bad rows so nothing plays while you regenerate.
//   2. Re-fire Create for that seed in Suno; wait for real durations on the cards.
//   3. Run this with the NEW take UUIDs.
//   4. Reactivate the rows.
//
// Usage: same base64 upload pattern as accept-song-seeds.mjs.
// argv[2] = base64 JSON [{ "lineageRowId": "...", "sourceUrl": "https://suno.com/song/<uuid>" }]
import { PrismaClient } from '@prisma/client'
const { downloadAndUploadFromUrl } = await import('file:///app/dist/lib/r2.js')

const MIN_BYTES = 500_000

const prisma = new PrismaClient()
const jobs = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf-8'))
const report = []

for (const { lineageRowId, sourceUrl } of jobs) {
  try {
    const row = await prisma.lineageRow.findUnique({ where: { id: lineageRowId } })
    if (!row) { report.push({ lineageRowId, ok: false, error: 'row_not_found' }); continue }
    const key = `song-seeds/${row.songSeedId}/repair-${lineageRowId.slice(0, 8)}-${Date.now()}.mp3`
    const obj = await downloadAndUploadFromUrl(sourceUrl, key)
    if (obj.byteSize < MIN_BYTES) {
      // Re-downloading a failed Suno render returns the same short bytes — the
      // clip really is that short. Regenerate before retrying this script.
      report.push({ lineageRowId, ok: false, error: `still_truncated_${obj.byteSize}b` })
      continue
    }
    await prisma.$transaction(async (tx) => {
      await tx.song.update({
        where: { id: row.songId },
        data: { r2Url: obj.url, r2ObjectKey: obj.key, byteSize: BigInt(obj.byteSize), contentType: obj.contentType },
      })
      await tx.lineageRow.update({ where: { id: lineageRowId }, data: { r2Url: obj.url } })
    })
    report.push({ lineageRowId, ok: true, bytes: obj.byteSize, url: obj.url })
  } catch (e) {
    report.push({ lineageRowId, ok: false, error: String(e.message || e).slice(0, 240) })
  }
}

console.log('REPAIRREPORT' + JSON.stringify(report) + 'ENDREPORT')
process.exit(0)
