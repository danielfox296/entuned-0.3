// CLI: pnpm tsx scripts/decompose.ts --artist "..." --title "..." --year 1968 [--genre southern-rock]

import 'dotenv/config'
import { decompose } from '../src/lib/decomposer/decomposer.js'
import { prisma } from '../src/db.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const artist = arg('artist')
  const title = arg('title')
  const year = arg('year') ? parseInt(arg('year')!, 10) : undefined
  const genreSlug = arg('genre')

  if (!artist || !title) {
    console.error('usage: pnpm tsx scripts/decompose.ts --artist "..." --title "..." [--year 1968] [--genre southern-rock]')
    process.exit(1)
  }

  console.log(`Decomposing: ${artist} — ${title}${year ? ` (${year})` : ''}\n`)
  const result = await decompose({ artist, title, year, genreSlug })
  console.log(`Model: ${result.modelId}`)
  console.log(`MusicologicalRules version: ${result.rulesVersion}`)
  console.log()
  console.log('--- Decomposition ---')
  for (const [k, v] of Object.entries(result.output)) {
    console.log(`\n${k}:`)
    console.log(`  ${v}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
