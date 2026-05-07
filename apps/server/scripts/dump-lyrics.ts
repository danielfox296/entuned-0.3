import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'

const p = new PrismaClient()

async function main() {
  const rows = await p.songSeed.findMany({
    where: { lyrics: { not: null } },
    select: { id: true, lyrics: true, title: true, status: true },
    orderBy: { createdAt: 'asc' },
  })
  writeFileSync('/tmp/entuned-lyrics-dump.json', JSON.stringify(rows, null, 2))
  console.log(`Dumped ${rows.length} song seeds with lyrics`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
