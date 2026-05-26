// Re-decompose approved ReferenceTracks whose StyleAnalysis is below the latest
// decomposer rules version. Idempotent: skips tracks already at LATEST.
//
// Iteration order: oldest decomposition version first, then by createdAt — so
// v5/v6 tracks get refreshed before v10 ones, and a small --limit smoke batch
// naturally samples the oldest material.
//
//   pnpm exec tsx scripts/backfill-decompositions.ts --limit 5
//   pnpm exec tsx scripts/backfill-decompositions.ts --limit 5 --dry-run
//   pnpm exec tsx scripts/backfill-decompositions.ts --limit 500
//
// Required: --limit N. No default — explicit batch sizing keeps spend honest.

import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/db.js'
import { decompose } from '../src/lib/decomposer/decomposer.js'

const LATEST = 12

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main() {
  const limitRaw = arg('limit')
  if (!limitRaw) {
    console.error('usage: pnpm exec tsx scripts/backfill-decompositions.ts --limit N [--dry-run]')
    process.exit(1)
  }
  const limit = parseInt(limitRaw, 10)
  if (!Number.isFinite(limit) || limit < 1) {
    console.error(`bad --limit value: ${limitRaw}`)
    process.exit(1)
  }
  const dryRun = hasFlag('dry-run')

  const rows = await prisma.styleAnalysis.findMany({
    where: {
      styleAnalyzerInstructionsVersion: { lt: LATEST },
      referenceTrack: { status: 'approved' },
    },
    include: {
      referenceTrack: {
        select: { id: true, artist: true, title: true, year: true, operatorNotes: true },
      },
    },
    orderBy: [
      { styleAnalyzerInstructionsVersion: 'asc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  })

  console.log(`[backfill] target LATEST=v${LATEST}, batch size=${limit}, dry-run=${dryRun}`)
  console.log(`[backfill] picked ${rows.length} stale row(s):`)
  for (const r of rows) {
    const ref = r.referenceTrack
    console.log(`  · v${r.styleAnalyzerInstructionsVersion}  ${ref.artist} — ${ref.title}${ref.year ? ` (${ref.year})` : ''}`)
    console.log(`       old eraProd: ${r.eraProductionSignature ?? '(null)'}`)
  }

  if (dryRun) {
    console.log('[backfill] dry-run — exiting without LLM calls')
    return
  }

  let succeeded = 0
  let failed = 0
  const errors: { artist: string; title: string; error: string }[] = []

  for (const r of rows) {
    const ref = r.referenceTrack
    const label = `${ref.artist} — ${ref.title}${ref.year ? ` (${ref.year})` : ''}`
    try {
      const result = await decompose({
        artist: ref.artist,
        title: ref.title,
        year: ref.year ?? undefined,
        operatorNotes: ref.operatorNotes ?? undefined,
      })
      const data = {
        styleAnalyzerInstructionsVersion: result.rulesVersion,
        status: 'draft' as const,
        verifiedAt: null,
        verifiedById: null,
        confidence: result.output.confidence,
        vibePitch: result.output.vibe_pitch,
        eraProductionSignature: result.output.era_production_signature,
        instrumentationPalette: result.output.instrumentation_palette,
        standoutElement: result.output.standout_element,
        arrangementShape: result.output.arrangement_shape ?? null,
        dynamicCurve: result.output.dynamic_curve ?? null,
        vocalCharacter: result.output.vocal_character,
        vocalArrangement: result.output.vocal_arrangement,
        harmonicAndGroove: result.output.harmonic_and_groove,
        arrangementSections: result.output.arrangement_sections ?? Prisma.JsonNull,
        arrangementVersion: result.output.arrangement_sections ? result.rulesVersion : null,
        bpm: result.output.bpm ?? null,
      }
      await prisma.styleAnalysis.upsert({
        where: { referenceTrackId: ref.id },
        create: { referenceTrackId: ref.id, ...data },
        update: data,
      })
      succeeded++
      console.log(`✓ v${r.styleAnalyzerInstructionsVersion}→v${result.rulesVersion}  ${label}`)
      console.log(`    new eraProd: ${result.output.era_production_signature}`)
    } catch (e: any) {
      failed++
      errors.push({ artist: ref.artist, title: ref.title, error: e?.message ?? 'unknown' })
      console.error(`✗ ${label}: ${e?.message ?? e}`)
    }
  }

  console.log()
  console.log(`[backfill] done. succeeded=${succeeded} failed=${failed} total=${rows.length}`)
  if (errors.length) {
    console.log('[backfill] errors:')
    for (const e of errors) {
      console.log(`  · ${e.artist} — ${e.title}: ${e.error}`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
