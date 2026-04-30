// Generate Adjacent picks for Gary @ UNTUCKit Park Meadows.
import { PrismaClient } from '@prisma/client'
import { suggestAdjacentReferenceTracks } from '../../src/lib/ref-tracks/adjacent-suggester.js'

const GARY_ICP = '1eaf3d99-8bc7-4a37-beaa-14483ea5517f'

;(async () => {
  const p = new PrismaClient()
  try {
    const result = await suggestAdjacentReferenceTracks({ icpId: GARY_ICP })
    console.log(`\nCreated ${result.createdCount} pending Adjacent ref tracks (prompt v${result.promptVersion})\n`)

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
