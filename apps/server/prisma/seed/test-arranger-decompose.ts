// One-off verification script: re-decomposes two Gary ref tracks under rules-v6
// to populate arrangement_sections, then runs Eno to seed two songs against them
// and prints the final lyrics so we can confirm [Instrument: ...] tags landed.
//
// Usage (locally, with .env loaded by tsx):
//   pnpm tsx prisma/seed/test-arranger-decompose.ts

import { Prisma, PrismaClient } from '@prisma/client'
import { decompose } from '../../src/lib/decomposer/decomposer.js'

const REFS_TO_REDECOMPOSE = [
  '21a3d775-5efa-4117-83b2-3ba99e1d9f7b', // SAULT — Wildfires (2020)
  '2ceffa5d-71cf-446b-97a5-ae11d3bff77e', // Fleet Foxes — White Winter Hymnal (2008)
]

async function main() {
  const p = new PrismaClient()
  try {
    for (const id of REFS_TO_REDECOMPOSE) {
      const ref = await p.referenceTrack.findUniqueOrThrow({
        where: { id },
        include: { styleAnalysis: true },
      })
      console.log(`\n=== Re-decomposing: ${ref.artist} — ${ref.title} (${ref.year}) ===`)
      const result = await decompose({
        artist: ref.artist,
        title: ref.title,
        year: ref.year ?? undefined,
        operatorNotes: ref.operatorNotes ?? undefined,
      })
      console.log(`Rules version used: v${result.rulesVersion}`)
      console.log(`Confidence: ${result.output.confidence}`)
      console.log(`arrangement_sections present: ${!!result.output.arrangement_sections}`)
      if (result.output.arrangement_sections) {
        console.log('Sections:')
        for (const [sec, dir] of Object.entries(result.output.arrangement_sections)) {
          console.log(`  ${sec}: [${(dir as any).instruments.join(', ')}] (density=${(dir as any).density ?? 'n/a'})`)
        }
      }

      const data = {
        styleAnalyzerInstructionsVersion: result.rulesVersion,
        status: 'draft',
        verifiedAt: null,
        verifiedById: null,
        confidence: result.output.confidence,
        vibePitch: result.output.vibe_pitch,
        eraProductionSignature: result.output.era_production_signature,
        instrumentationPalette: result.output.instrumentation_palette,
        standoutElement: result.output.standout_element,
        arrangementShape: result.output.arrangement_shape,
        dynamicCurve: result.output.dynamic_curve,
        vocalCharacter: result.output.vocal_character,
        vocalArrangement: result.output.vocal_arrangement,
        harmonicAndGroove: result.output.harmonic_and_groove,
        arrangementSections: (result.output.arrangement_sections ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        arrangementVersion: result.output.arrangement_sections ? result.rulesVersion : null,
      }
      await p.styleAnalysis.upsert({
        where: { referenceTrackId: id },
        create: { referenceTrackId: id, ...data },
        update: data,
      })
      console.log(`  ✓ StyleAnalysis upserted`)
    }
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
