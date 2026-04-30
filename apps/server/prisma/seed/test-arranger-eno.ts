// E2E verification: forces a SongSeed against each of the v6-decomposed ref tracks,
// runs the full assembly pipeline (Mars + Bernie + Arranger), and prints the
// resulting lyrics so we can confirm [Instrument: ...] tags landed where expected.

import { Prisma, PrismaClient } from '@prisma/client'
import { marsAssemble } from '../../src/lib/mars/mars.js'
import { generateLyrics } from '../../src/lib/bernie/bernie.js'
import { injectArrangement, type ArrangementSections } from '../../src/lib/arranger/arranger.js'
import { applyOutcomeFactorPrompt, getOrSeedOutcomeFactorPrompt } from '../../src/lib/eno/eno.js'

const GARY_ICP = '1eaf3d99-8bc7-4a37-beaa-14483ea5517f'
const REFS = [
  '21a3d775-5efa-4117-83b2-3ba99e1d9f7b', // SAULT — Wildfires
  '2ceffa5d-71cf-446b-97a5-ae11d3bff77e', // Fleet Foxes — White Winter Hymnal
]

async function main() {
  const p = new PrismaClient()
  try {
    // Find an active outcome with at least one approved Gary hook.
    const hookByOutcome = await p.hook.findFirst({
      where: { icpId: GARY_ICP, status: 'approved', outcome: { supersededAt: null } },
      include: { outcome: true },
      orderBy: { useCount: 'asc' },
    })
    if (!hookByOutcome) throw new Error('No approved Gary hook with active outcome')
    const outcome = hookByOutcome.outcome
    console.log(`Outcome: ${outcome.title} (${outcome.id}) — ${outcome.tempoBpm}bpm ${outcome.mode}`)

    const batch = await p.songSeedBatch.create({
      data: { icpId: GARY_ICP, outcomeId: outcome.id, requestedN: REFS.length, triggeredBy: 'manual' },
    })
    console.log(`Batch: ${batch.id}\n`)

    const outcomeFactorPrompt = await getOrSeedOutcomeFactorPrompt()
    const client = await p.client.findUniqueOrThrow({
      where: { id: (await p.iCP.findUniqueOrThrow({ where: { id: GARY_ICP } })).clientId },
    })

    const seedIds: string[] = []

    for (const refId of REFS) {
      const refTrack = await p.referenceTrack.findUniqueOrThrow({
        where: { id: refId },
        include: { styleAnalysis: true },
      })
      if (!refTrack.styleAnalysis) throw new Error(`Ref ${refId} has no StyleAnalysis`)

      // Pick a fresh approved hook for this outcome (different per loop iteration via skip).
      const hook = await p.hook.findFirst({
        where: { icpId: GARY_ICP, outcomeId: outcome.id, status: 'approved' },
        orderBy: { useCount: 'asc' },
        skip: REFS.indexOf(refId), // crude differentiation
      })
      if (!hook) throw new Error('No hook available')
      console.log(`=== Ref: ${refTrack.artist} — ${refTrack.title} | Hook: "${hook.text}"`)

      const seed = await p.songSeed.create({
        data: {
          songSeedBatchId: batch.id,
          icpId: GARY_ICP,
          hookId: hook.id,
          outcomeId: outcome.id,
          referenceTrackId: refId,
          status: 'assembling',
        },
      })

      const mars = await marsAssemble(refTrack.styleAnalysis as any, outcome)
      const finalStyle = applyOutcomeFactorPrompt(mars.style, outcome, outcomeFactorPrompt.templateText)

      const lyricsRaw = await generateLyrics({
        hookText: hook.text,
        brandLyricGuidelines: client.brandLyricGuidelines ?? null,
      })

      const arrangementSections = refTrack.styleAnalysis.arrangementSections as ArrangementSections | null
      const arrangementVersion = refTrack.styleAnalysis.arrangementVersion
      const finalLyrics = arrangementSections
        ? injectArrangement(lyricsRaw.lyrics, arrangementSections)
        : lyricsRaw.lyrics

      console.log(`\n--- Title: ${lyricsRaw.title}`)
      console.log(`--- arrangementVersion=${arrangementVersion} sections=${arrangementSections ? Object.keys(arrangementSections).join(',') : 'null'}`)
      console.log(`--- Final lyrics (with [Instrument:] tags injected):\n`)
      console.log(finalLyrics)
      console.log(`\n--- Style:\n${finalStyle}\n`)

      await p.songSeed.update({
        where: { id: seed.id },
        data: {
          status: 'queued',
          style: finalStyle,
          stylePortionRaw: mars.style,
          negativeStyle: mars.negativeStyle,
          vocalGender: mars.vocalGender,
          lyrics: finalLyrics,
          title: lyricsRaw.title,
          outcomeFactorPromptVersion: outcomeFactorPrompt.version,
          styleTemplateVersion: mars.styleTemplateVersion,
          lyricDraftPromptVersion: lyricsRaw.draftPromptVersion,
          lyricEditPromptVersion: lyricsRaw.editPromptVersion,
          arrangementTemplateVersion: arrangementSections ? arrangementVersion : null,
          firedExclusionRuleIds: mars.firedExclusionRuleIds,
        },
      })
      seedIds.push(seed.id)
      console.log(`✓ SongSeed ${seed.id} queued\n${'='.repeat(80)}\n`)
    }

    await p.songSeedBatch.update({
      where: { id: batch.id },
      data: { producedN: seedIds.length, reason: 'complete', finishedAt: new Date() },
    })

    console.log(`\nSeed IDs for Suno generation: ${seedIds.join(' ')}`)
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
