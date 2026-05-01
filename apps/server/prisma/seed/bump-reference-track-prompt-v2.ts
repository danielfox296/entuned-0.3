// Bump ReferenceTrackPrompt to v2 — unified suggester that produces all four
// buckets (FormationEra/Subculture/Aspirational/Adjacent) in one call.
//
// Replaces the divergent standalone Adjacent suggester. v1 stays in the
// version history for provenance on suggestions made before this rollover.

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
        notes: `v${next} — unified all four buckets (Adjacent merged in from standalone suggester)`,
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
