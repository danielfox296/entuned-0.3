// One-shot: set display names for Boost-tier outcomes to retail-associate-legible labels.
// Matches against all known historical title/displayTitle variants (case-insensitive)
// so it runs cleanly regardless of current displayTitle state.
// Run: railway run tsx prisma/seed/rename-outcomes-2026-05-14.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Each entry: all names this outcome has ever gone by → new display name.
const RENAMES: Array<{ variants: string[]; displayTitle: string }> = [
  { variants: ['linger'],                                      displayTitle: 'Stay & Browse' },
  { variants: ['browse to buy', 'convert browsers'],           displayTitle: 'Help Them Decide' },
  { variants: ['value lift', 'increase order value'],          displayTitle: 'Trade Them Up' },
  { variants: ['add items', 'add more items'],                 displayTitle: 'Fill the Basket' },
  { variants: ['impulse', 'impulse buy'],                      displayTitle: 'Grab It Now' },
  { variants: ['move through'],                                displayTitle: 'Keep It Moving' },
  { variants: ['brand match', 'reinforce brand'],              displayTitle: 'Our Sound' },
  { variants: ['status lift'],                                 displayTitle: 'Swagger Spend' },
]

async function main() {
  let totalUpdated = 0

  for (const { variants, displayTitle } of RENAMES) {
    // Match against effective display name (displayTitle ?? title), case-insensitive.
    const outcomes = await prisma.outcome.findMany({
      where: {
        supersededAt: null,
        OR: variants.flatMap((v) => [
          { title:        { equals: v, mode: 'insensitive' as const } },
          { displayTitle: { equals: v, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true, title: true, displayTitle: true },
    })

    if (outcomes.length === 0) {
      console.warn(`⚠  No active outcome found for variants: ${variants.join(', ')} — skipping`)
      continue
    }

    await prisma.outcome.updateMany({
      where: { id: { in: outcomes.map((o) => o.id) } },
      data: { displayTitle },
    })

    for (const o of outcomes) {
      console.log(`✓  "${o.displayTitle ?? o.title}" → "${displayTitle}"`)
    }
    totalUpdated += outcomes.length
  }

  console.log(`\nDone — updated ${totalUpdated} outcome(s).`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
