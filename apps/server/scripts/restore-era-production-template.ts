// One-off: re-add `eraProductionSignature` to the active style_templates row.
//
// Context: operator-edited template versions trimmed eraProductionSignature out
// for token economy, which dropped era artifacts from Mars output entirely.
// Paired with decomposer rules-v11 (40-char budget on eraProductionSignature),
// it's now cheap enough to keep in the template.
//
// Run locally (connects to prod Railway DB via apps/server/.env DATABASE_URL):
//   cd apps/server && pnpm exec tsx scripts/restore-era-production-template.ts
//
// Idempotent: if the latest version already includes eraProductionSignature,
// it's a no-op.

import 'dotenv/config'
import { prisma } from '../src/db.js'

const FIELD = 'eraProductionSignature'

async function main() {
  const latest = await prisma.styleTemplate.findFirst({ orderBy: { version: 'desc' } })
  if (!latest) {
    console.log('[restore] no style_templates rows found — cold-start seed will handle on next request')
    return
  }

  console.log(`[restore] latest is v${latest.version}: fields=[${latest.fields.join(', ')}] charCap=${latest.charCap}`)

  if (latest.fields.includes(FIELD)) {
    console.log(`[restore] '${FIELD}' already present in v${latest.version} — no-op`)
    return
  }

  // Insert right after vibePitch (the seed rationale: vibePitch leads, era second).
  // Fallback: prepend if vibePitch is absent.
  const vibePitchIdx = latest.fields.indexOf('vibePitch')
  const insertAt = vibePitchIdx >= 0 ? vibePitchIdx + 1 : 0
  const newFields = [
    ...latest.fields.slice(0, insertAt),
    FIELD,
    ...latest.fields.slice(insertAt),
  ]

  const nextVersion = latest.version + 1
  const created = await prisma.styleTemplate.create({
    data: {
      version: nextVersion,
      fields: newFields,
      charCap: latest.charCap,
      templateText: `fields: [${newFields.join(', ')}] · cap: ${latest.charCap}`,
      notes: `Re-add '${FIELD}' (post rules-v11 40-char budget). Promoted from v${latest.version}.`,
    },
  })

  console.log(`[restore] inserted v${created.version}: fields=[${created.fields.join(', ')}] charCap=${created.charCap}`)
  console.log(`[restore] '${FIELD}' inserted at index ${insertAt}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
