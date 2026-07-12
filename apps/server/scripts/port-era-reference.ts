// One-shot port: copy Ronson `era_reference` rows from the Mingus DB into entuned-0.3.
// Idempotent — uses (decade, genre_slug) as the natural key.
//
//   pnpm tsx scripts/port-era-reference.ts
//
// Reads MINGUS_DATABASE_URL for the source; default DATABASE_URL for the destination.

import { Client as PgClient } from 'pg'
import { PrismaClient } from '@prisma/client'

// Resolve the source (Mingus) connection string from the environment.
// No literal fallback — a hardcoded credential here would leak into git history.
export function requireMingusUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.MINGUS_DATABASE_URL
  if (!url) {
    throw new Error(
      'MINGUS_DATABASE_URL is not set. Export the Mingus source connection string before running this port script — there is no default.',
    )
  }
  return url
}

const prisma = new PrismaClient()

async function main() {
  const src = new PgClient({ connectionString: requireMingusUrl() })
  await src.connect()

  const { rows } = await src.query(`
    SELECT
      decade,
      genre_slug,
      genre_display_name,
      is_era_overview,
      prompt_block,
      texture_language,
      exclude_list,
      bpm_range_low,
      bpm_range_high,
      bpm_compensation,
      extension_techniques,
      instruments,
      recording_chain,
      vocals_description,
      suno_drift_notes,
      notes,
      is_active
    FROM era_reference
    WHERE is_active
    ORDER BY decade, genre_slug
  `)
  await src.end()

  let upserted = 0
  for (const r of rows) {
    await prisma.eraReference.upsert({
      where: { decade_genreSlug: { decade: r.decade, genreSlug: r.genre_slug } },
      update: {
        genreDisplayName: r.genre_display_name,
        isEraOverview: r.is_era_overview,
        promptBlock: r.prompt_block,
        textureLanguage: r.texture_language,
        excludeList: r.exclude_list,
        bpmRangeLow: r.bpm_range_low,
        bpmRangeHigh: r.bpm_range_high,
        bpmCompensation: r.bpm_compensation,
        extensionTechniques: r.extension_techniques,
        instruments: r.instruments,
        recordingChain: r.recording_chain,
        vocalsDescription: r.vocals_description,
        sunoDriftNotes: r.suno_drift_notes,
        notes: r.notes,
        isActive: r.is_active,
      },
      create: {
        decade: r.decade,
        genreSlug: r.genre_slug,
        genreDisplayName: r.genre_display_name,
        isEraOverview: r.is_era_overview,
        promptBlock: r.prompt_block,
        textureLanguage: r.texture_language,
        excludeList: r.exclude_list,
        bpmRangeLow: r.bpm_range_low,
        bpmRangeHigh: r.bpm_range_high,
        bpmCompensation: r.bpm_compensation,
        extensionTechniques: r.extension_techniques,
        instruments: r.instruments,
        recordingChain: r.recording_chain,
        vocalsDescription: r.vocals_description,
        sunoDriftNotes: r.suno_drift_notes,
        notes: r.notes,
        isActive: r.is_active,
      },
    })
    upserted++
  }

  console.log(`Ported ${upserted} era_reference rows.`)
  console.log(`Coverage:`)
  const decades = await prisma.eraReference.groupBy({
    by: ['decade'],
    _count: { _all: true },
    orderBy: { decade: 'asc' },
  })
  for (const d of decades) {
    console.log(`  ${d.decade}: ${d._count._all} rows`)
  }
}

// Only run when executed directly (`pnpm tsx scripts/port-era-reference.ts`),
// not when imported by a test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((e) => { console.error(e); process.exit(1) })
    .finally(() => prisma.$disconnect())
}
