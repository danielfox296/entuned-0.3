// Count StyleAnalysis rows whose styleAnalyzerInstructionsVersion is below the
// latest decomposer rules version. Read-only — prints summary, doesn't mutate.
//
//   pnpm exec tsx scripts/count-stale-decompositions.ts

import 'dotenv/config'
import { prisma } from '../src/db.js'

const LATEST = 12

async function main() {
  const total = await prisma.referenceTrack.count({ where: { status: 'approved' } })
  const noAnalysis = await prisma.referenceTrack.count({
    where: { status: 'approved', styleAnalysis: null },
  })
  const stale = await prisma.styleAnalysis.count({
    where: {
      styleAnalyzerInstructionsVersion: { lt: LATEST },
      referenceTrack: { status: 'approved' },
    },
  })
  const current = await prisma.styleAnalysis.count({
    where: {
      styleAnalyzerInstructionsVersion: LATEST,
      referenceTrack: { status: 'approved' },
    },
  })
  const byVersion = await prisma.styleAnalysis.groupBy({
    by: ['styleAnalyzerInstructionsVersion'],
    where: { referenceTrack: { status: 'approved' } },
    _count: { _all: true },
    orderBy: { styleAnalyzerInstructionsVersion: 'asc' },
  })

  console.log(`Approved ReferenceTracks total: ${total}`)
  console.log(`  · with no StyleAnalysis at all: ${noAnalysis}`)
  console.log(`  · with StyleAnalysis at v${LATEST} (current): ${current}`)
  console.log(`  · with StyleAnalysis below v${LATEST} (stale, needs re-decompose): ${stale}`)
  console.log()
  console.log('Breakdown by styleAnalyzerInstructionsVersion (approved tracks only):')
  for (const row of byVersion) {
    console.log(`  v${row.styleAnalyzerInstructionsVersion}: ${row._count._all}`)
  }
  console.log()
  console.log(`Backfill scope: ${stale + noAnalysis} tracks need decompose() at v${LATEST}.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
