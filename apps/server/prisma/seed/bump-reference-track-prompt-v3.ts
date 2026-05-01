// Bump ReferenceTrackPrompt to v3 — adds the no-instrumentals rule.
import { PrismaClient } from '@prisma/client'
import { REFERENCE_TRACK_PROMPT_SEED } from '../../src/lib/ref-tracks/suggester.js'

;(async () => {
  const p = new PrismaClient()
  try {
    const max = await p.referenceTrackPrompt.aggregate({ _max: { version: true } })
    const next = (max._max.version ?? 0) + 1
    const row = await p.referenceTrackPrompt.create({
      data: {
        version: next,
        templateText: REFERENCE_TRACK_PROMPT_SEED,
        notes: `v${next} — added no-instrumentals rule for Entuned vocal-pipeline compatibility`,
      },
    })
    console.log(`Created ReferenceTrackPrompt v${row.version} (length: ${row.templateText.length} chars)`)
  } finally {
    await p.$disconnect()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
