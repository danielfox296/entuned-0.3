// Verify the unified suggester (v2) produces all four buckets in one call.
import { PrismaClient } from '@prisma/client'
import { suggestReferenceTracks } from '../../src/lib/ref-tracks/suggester.js'

const TERRELL_ICP = '781505a1-220f-4894-a350-9a4344af1319'

;(async () => {
  const p = new PrismaClient()
  try {
    const result = await suggestReferenceTracks({ icpId: TERRELL_ICP })
    console.log(`\nCreated ${result.createdCount} pending ref tracks (prompt v${result.promptVersion})`)

    // Look at what landed grouped by bucket
    const fresh = await p.referenceTrack.findMany({
      where: { icpId: TERRELL_ICP, status: 'pending' },
      orderBy: { suggestedAt: 'desc' },
      take: result.createdCount,
    })

    const byBucket: Record<string, typeof fresh> = {}
    for (const r of fresh) {
      ;(byBucket[r.bucket] ??= []).push(r)
    }

    for (const bucket of ['FormationEra', 'Subculture', 'Aspirational', 'Adjacent']) {
      const rows = byBucket[bucket] ?? []
      console.log(`\n=== ${bucket} (${rows.length}) ===`)
      for (const r of rows) {
        console.log(`  ${r.artist} — ${r.title}${r.year ? ` (${r.year})` : ''}`)
        if (r.suggestedRationale) console.log(`    ${r.suggestedRationale}`)
      }
    }
  } finally {
    await p.$disconnect()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
