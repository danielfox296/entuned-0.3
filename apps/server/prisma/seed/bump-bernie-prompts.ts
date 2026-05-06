// Bump LyricDraftPrompt + LyricEditPrompt to a new version using the current
// in-code seeds. The DB rows are the source of truth in production; updating
// the SEED constants in proto-bernie/lyrics.ts has no effect on existing DBs
// until this script promotes them.
//
// Usage (from monorepo root):
//   cd entuned-0.3 && railway up --detach
//   railway ssh "cd /app && node --import tsx -e \"
//     import('file:///app/prisma/seed/bump-bernie-prompts.ts');
//   \""

import { PrismaClient } from '@prisma/client'
import { DRAFT_PROMPT_SEED, EDIT_PROMPT_SEED } from '../../src/lib/proto-bernie/lyrics.js'

;(async () => {
  const p = new PrismaClient()
  try {
    const draftMax = await p.lyricDraftPrompt.aggregate({ _max: { version: true } })
    const draftNext = (draftMax._max.version ?? 0) + 1
    const draftRow = await p.lyricDraftPrompt.create({
      data: {
        version: draftNext,
        promptText: DRAFT_PROMPT_SEED,
        notes: `v${draftNext} — Suno prompt-craft upgrades (structural craft block, hook-verbatim across [Final Chorus])`,
      },
    })
    console.log(`Created LyricDraftPrompt v${draftRow.version} (${draftRow.promptText.length} chars)`)

    const editMax = await p.lyricEditPrompt.aggregate({ _max: { version: true } })
    const editNext = (editMax._max.version ?? 0) + 1
    const editRow = await p.lyricEditPrompt.create({
      data: {
        version: editNext,
        promptText: EDIT_PROMPT_SEED,
        notes: `v${editNext} — Suno prompt-craft upgrades (no-go list, performance typography, polish rules)`,
      },
    })
    console.log(`Created LyricEditPrompt v${editRow.version} (${editRow.promptText.length} chars)`)
  } finally {
    await p.$disconnect()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
