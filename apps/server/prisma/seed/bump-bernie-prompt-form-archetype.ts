// Promote the in-code DRAFT_PROMPT_SEED to a new LyricDraftPrompt version that
// removes the hardcoded V/C/V/C/Bridge/Final-C song shape and instructs Bernie
// to read the form from the user message's "Song form" block. Pairs with
// FormArchetype seed + Eno's pickFormArchetype() integration.
//
// Usage (from monorepo root):
//   cd entuned-0.3 && railway up --detach
//   railway ssh "cd /app && node --import tsx -e \"
//     import('file:///app/prisma/seed/bump-bernie-prompt-form-archetype.ts');
//   \""
//
// Edit prompt is unchanged — its hook-preservation rules already accommodate
// the looser "wherever the form note instructs" semantics by counting hook
// occurrences against the draft.

import { PrismaClient } from '@prisma/client'
import { DRAFT_PROMPT_SEED } from '../../src/lib/proto-bernie/lyrics.js'

;(async () => {
  const p = new PrismaClient()
  try {
    const draftMax = await p.lyricDraftPrompt.aggregate({ _max: { version: true } })
    const draftNext = (draftMax._max.version ?? 0) + 1
    const draftRow = await p.lyricDraftPrompt.create({
      data: {
        version: draftNext,
        promptText: DRAFT_PROMPT_SEED,
        notes: `v${draftNext} — form-archetype rollout: removed hardcoded V/C/V/C/Bridge/Final-C shape. Bernie now reads section list + shape note from the user message.`,
      },
    })
    console.log(`Created LyricDraftPrompt v${draftRow.version} (${draftRow.promptText.length} chars)`)
  } finally {
    await p.$disconnect()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
