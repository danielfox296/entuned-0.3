// Generate Adjacent picks for Gary @ UNTUCKit Park Meadows.
import { PrismaClient } from '@prisma/client'
import { suggestAdjacentReferenceTracks } from '../../src/lib/ref-tracks/adjacent-suggester.js'

const GARY_ICP = '1eaf3d99-8bc7-4a37-beaa-14483ea5517f'

;(async () => {
  const p = new PrismaClient()
  try {
    // Wipe v1 pending picks so v2 isn't dedup-blocked by the prior batch.
    const cleared = await p.referenceTrack.deleteMany({
      where: { icpId: GARY_ICP, bucket: 'Adjacent', status: 'pending' },
    })
    console.log(`Cleared ${cleared.count} pending v1 Adjacent picks before re-running.\n`)

    const result = await suggestAdjacentReferenceTracks({ icpId: GARY_ICP })
    console.log(`Created ${result.createdCount} pending Adjacent ref tracks (prompt v${result.promptVersion})\n`)

    if (result.dominantCluster) {
      console.log(`Dominant cluster (named by model): ${result.dominantCluster}\n`)
    }

    if (result.vectors.length > 0) {
      console.log('=== Adjacency vectors ===')
      for (const v of result.vectors) {
        console.log(`\n  [${v.name}]`)
        if (v.axisBroken) console.log(`    breaks: ${v.axisBroken}`)
        if (v.axisHeld) console.log(`    holds:  ${v.axisHeld}`)
        if (v.rationale) console.log(`    why:    ${v.rationale}`)
      }
      console.log('')
    }

    const picks = await p.referenceTrack.findMany({
      where: { icpId: GARY_ICP, bucket: 'Adjacent', status: 'pending' },
      orderBy: { suggestedAt: 'desc' },
      take: result.createdCount,
    })
    console.log('=== Adjacent picks for Gary ===')
    for (const r of picks) {
      console.log(`\n${r.artist} — ${r.title}${r.year ? ` (${r.year})` : ''}`)
      console.log(`  ${r.suggestedRationale ?? '(no rationale)'}`)
    }
  } finally {
    await p.$disconnect()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
