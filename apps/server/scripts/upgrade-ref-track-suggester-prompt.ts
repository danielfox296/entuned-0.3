// One-off upgrade: insert a new ReferenceTrackPrompt row with the latest seed text.
// Run via:
//   pnpm exec tsx apps/server/scripts/upgrade-ref-track-suggester-prompt.ts
// Or in Railway SSH:
//   node --import tsx /app/apps/server/scripts/upgrade-ref-track-suggester-prompt.ts
//
// Idempotent: if the latest DB row's templateText already matches REFERENCE_TRACK_PROMPT_SEED,
// it's a no-op.

import 'dotenv/config'
import { prisma } from '../src/db.js'
import { REFERENCE_TRACK_PROMPT_SEED } from '../src/lib/ref-tracks/suggester.js'

async function main() {
  const latest = await prisma.referenceTrackPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (latest && latest.templateText === REFERENCE_TRACK_PROMPT_SEED) {
    console.log(`[upgrade] latest version v${latest.version} already matches the seed — no-op.`)
    return
  }
  const nextVersion = (latest?.version ?? 0) + 1
  const created = await prisma.referenceTrackPrompt.create({
    data: { version: nextVersion, templateText: REFERENCE_TRACK_PROMPT_SEED },
  })
  console.log(`[upgrade] inserted referenceTrackPrompt v${created.version} (id=${created.id})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
