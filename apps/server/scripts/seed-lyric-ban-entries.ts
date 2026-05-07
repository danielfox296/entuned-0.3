import { PrismaClient } from '@prisma/client'
import { OVERUSED_WORDS, AI_CLICHE_PHRASES, AI_CLICHE_SHAPES } from '../src/lib/bernie/lyric-craft-rules.js'

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.lyricBanEntry.count()
  if (existing > 0) {
    console.log(`Already ${existing} entries — skipping seed.`)
    return
  }

  const entries: { category: string; text: string }[] = []
  for (const w of OVERUSED_WORDS) entries.push({ category: 'overused_word', text: w })
  for (const p of AI_CLICHE_PHRASES) entries.push({ category: 'cliche_phrase', text: p })
  for (const s of AI_CLICHE_SHAPES) entries.push({ category: 'cliche_shape', text: s })

  const result = await prisma.lyricBanEntry.createMany({ data: entries })
  console.log(`Seeded ${result.count} lyric ban entries.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
