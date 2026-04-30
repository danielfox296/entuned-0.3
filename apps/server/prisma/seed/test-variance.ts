// Verification: set variance on Gary's Dwell Extension outcome, generate 6 seeds,
// print the spread of resolved tempo + mode to confirm sampling actually varies.
//
// Lives at the eno level (calls createSongSeed via runEno-like loop) so we test
// the wired-in resolver, not just the pure function in isolation.

import { Prisma, PrismaClient } from '@prisma/client'
import { marsAssemble } from '../../src/lib/mars/mars.js'
import { generateLyrics } from '../../src/lib/bernie/bernie.js'
import { injectArrangement, type ArrangementSections } from '../../src/lib/arranger/arranger.js'
import { applyOutcomeFactorPrompt, getOrSeedOutcomeFactorPrompt } from '../../src/lib/eno/eno.js'
import { resolveOutcomeParams } from '../../src/lib/variance/variance.js'

const GARY_ICP = '1eaf3d99-8bc7-4a37-beaa-14483ea5517f'
const DWELL_EXTENSION_OUTCOME = 'ea37958e-bb90-4497-8ca6-505c50e8e3ae'
const N_SEEDS = 6

async function main() {
  const p = new PrismaClient()
  try {
    // Step 1 — set variance on the outcome.
    const updated = await p.outcome.update({
      where: { id: DWELL_EXTENSION_OUTCOME },
      data: {
        tempoBpmRadius: 10, // ±10 BPM around the center
        modeWeights: { minor: 0.7, major: 0.3 } as Prisma.InputJsonValue,
      },
    })
    console.log(`Outcome configured: ${updated.title}`)
    console.log(`  Center: ${updated.tempoBpm}bpm ${updated.mode}`)
    console.log(`  Variance: ±${updated.tempoBpmRadius}bpm, modeWeights=${JSON.stringify(updated.modeWeights)}`)
    console.log('')

    // Step 2 — pre-flight: pick fixed ref track + fixed hook so only variance varies.
    // Use the SAULT v6 ref so arrangement injection still happens.
    const ref = await p.referenceTrack.findUniqueOrThrow({
      where: { id: '21a3d775-5efa-4117-83b2-3ba99e1d9f7b' },
      include: { styleAnalysis: true },
    })
    if (!ref.styleAnalysis) throw new Error('Ref has no StyleAnalysis')

    const hook = await p.hook.findFirstOrThrow({
      where: { icpId: GARY_ICP, outcomeId: DWELL_EXTENSION_OUTCOME, status: 'approved' },
      orderBy: { useCount: 'asc' },
    })

    const batch = await p.songSeedBatch.create({
      data: {
        icpId: GARY_ICP,
        outcomeId: DWELL_EXTENSION_OUTCOME,
        requestedN: N_SEEDS,
        triggeredBy: 'manual',
      },
    })
    console.log(`Batch ${batch.id} — generating ${N_SEEDS} seeds with fixed ref (${ref.artist}) and fixed hook ("${hook.text}")\n`)

    const ofp = await getOrSeedOutcomeFactorPrompt()

    // Step 3 — but instead of full Eno (which calls Bernie 6x = expensive), we'll
    // exercise the resolver path directly and just call Bernie ONCE then reuse
    // the lyrics across seeds. The thing under test is the variance sampling +
    // its propagation to applyOutcomeFactorPrompt + storage on SongSeed.
    const sharedLyrics = await generateLyrics({ hookText: hook.text, brandLyricGuidelines: null })
    const arrSections = ref.styleAnalysis.arrangementSections as ArrangementSections | null
    const sharedFinalLyrics = arrSections ? injectArrangement(sharedLyrics.lyrics, arrSections) : sharedLyrics.lyrics

    const results: Array<{ id: string; tempo: number; mode: string; styleHead: string }> = []

    for (let i = 0; i < N_SEEDS; i++) {
      const fresh = await p.outcome.findUniqueOrThrow({ where: { id: DWELL_EXTENSION_OUTCOME } })
      const resolved = resolveOutcomeParams({
        tempoBpm: fresh.tempoBpm,
        tempoBpmRadius: fresh.tempoBpmRadius,
        mode: fresh.mode,
        modeWeights: fresh.modeWeights,
      })

      const mars = await marsAssemble(ref.styleAnalysis, fresh)
      const finalStyle = applyOutcomeFactorPrompt(
        mars.style,
        { tempoBpm: resolved.tempoBpm, mode: resolved.mode, dynamics: fresh.dynamics, instrumentation: fresh.instrumentation },
        ofp.templateText,
      )

      const seed = await p.songSeed.create({
        data: {
          songSeedBatchId: batch.id,
          icpId: GARY_ICP,
          hookId: hook.id,
          outcomeId: DWELL_EXTENSION_OUTCOME,
          referenceTrackId: ref.id,
          status: 'queued',
          style: finalStyle,
          stylePortionRaw: mars.style,
          negativeStyle: mars.negativeStyle,
          vocalGender: mars.vocalGender,
          lyrics: sharedFinalLyrics,
          title: `${sharedLyrics.title} (variance test ${i + 1})`,
          outcomeFactorPromptVersion: ofp.version,
          styleTemplateVersion: mars.styleTemplateVersion,
          lyricDraftPromptVersion: sharedLyrics.draftPromptVersion,
          lyricEditPromptVersion: sharedLyrics.editPromptVersion,
          arrangementTemplateVersion: arrSections ? ref.styleAnalysis.arrangementVersion : null,
          resolvedTempoBpm: resolved.tempoBpm,
          resolvedMode: resolved.mode,
          firedExclusionRuleIds: mars.firedExclusionRuleIds,
        },
      })

      results.push({
        id: seed.id,
        tempo: resolved.tempoBpm,
        mode: resolved.mode,
        styleHead: finalStyle.slice(0, 80),
      })
    }

    await p.songSeedBatch.update({
      where: { id: batch.id },
      data: { producedN: results.length, reason: 'complete', finishedAt: new Date() },
    })

    console.log('=== Variance spread ===')
    for (const r of results) {
      console.log(`  ${r.tempo}bpm ${r.mode.padEnd(6)} | ${r.id} | ${r.styleHead}...`)
    }

    const tempos = results.map((r) => r.tempo)
    const modes = results.map((r) => r.mode)
    const tempoMin = Math.min(...tempos)
    const tempoMax = Math.max(...tempos)
    const tempoUnique = new Set(tempos).size
    const modeUnique = new Set(modes).size
    const minorCount = modes.filter((m) => m === 'minor').length
    const majorCount = modes.filter((m) => m === 'major').length
    console.log('')
    console.log(`Tempo spread: ${tempoMin}–${tempoMax}bpm (${tempoUnique} unique values across ${N_SEEDS} seeds)`)
    console.log(`Mode spread: ${modeUnique} unique modes — minor=${minorCount} major=${majorCount}`)
    console.log(`Center: ${updated.tempoBpm}bpm. All values within ±${updated.tempoBpmRadius}? ${tempos.every((t) => Math.abs(t - updated.tempoBpm) <= (updated.tempoBpmRadius ?? 0))}`)
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
