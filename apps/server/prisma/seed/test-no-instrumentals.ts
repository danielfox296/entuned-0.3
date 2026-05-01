// Verify: prompt v3 produces no instrumental refs across all 4 buckets.
import { PrismaClient } from '@prisma/client'
import { suggestReferenceTracks } from '../../src/lib/ref-tracks/suggester.js'

const TERRELL_ICP = '781505a1-220f-4894-a350-9a4344af1319'

;(async () => {
  const p = new PrismaClient()
  try {
    // Clear v2 pending picks so v3 has room to land freshly.
    const cleared = await p.referenceTrack.deleteMany({
      where: { icpId: TERRELL_ICP, status: 'pending' },
    })
    console.log(`Cleared ${cleared.count} pending picks before re-running.\n`)

    const result = await suggestReferenceTracks({ icpId: TERRELL_ICP })
    console.log(`Created ${result.createdCount} pending refs (prompt v${result.promptVersion})\n`)

    const fresh = await p.referenceTrack.findMany({
      where: { icpId: TERRELL_ICP, status: 'pending' },
      orderBy: { suggestedAt: 'desc' },
      take: result.createdCount,
    })

    const byBucket: Record<string, typeof fresh> = {}
    for (const r of fresh) {
      ;(byBucket[r.bucket] ??= []).push(r)
    }

    // Heuristic instrumental flag — flags artists or titles that are commonly known instrumentals.
    const KNOWN_INSTRUMENTAL_ARTISTS = [
      'bill evans', 'pat metheny', 'max richter', 'nils frahm', 'ryuichi sakamoto',
      'olafur arnalds', 'ólafur arnalds', 'jon hopkins', 'floating points',
      'brian eno', 'aphex twin', 'boards of canada', 'gas (wolfgang voigt)',
      'cinematic orchestra', 'bonobo' /* bonobo has vocal tracks too */,
    ]

    let suspicious = 0
    for (const bucket of ['FormationEra', 'Subculture', 'Aspirational', 'Adjacent']) {
      const rows = byBucket[bucket] ?? []
      console.log(`=== ${bucket} (${rows.length}) ===`)
      for (const r of rows) {
        const flag = KNOWN_INSTRUMENTAL_ARTISTS.some((a) => r.artist.toLowerCase().includes(a))
          ? ' ⚠ ARTIST MAYBE INSTRUMENTAL'
          : ''
        if (flag) suspicious++
        console.log(`  ${r.artist} — ${r.title}${r.year ? ` (${r.year})` : ''}${flag}`)
      }
      console.log('')
    }

    console.log(`Suspicious (likely instrumental) picks: ${suspicious}/${fresh.length}`)
  } finally {
    await p.$disconnect()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
