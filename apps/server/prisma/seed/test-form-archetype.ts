// Smoke test for the form archetype system. Two checks:
//   1. Selector distribution — call pickFormArchetype() many times across a
//      grid of (outcome, era) inputs, print frequency. Verifies weights,
//      era gating, and "*" fallback all work end-to-end against live DB.
//   2. Bernie integration — call generateLyrics() with a fake hook + the
//      AABA archetype (riskiest, since it has no [Chorus] section). Verify
//      output uses the AABA section list, the chosen draft prompt version,
//      and embeds the hook as a verse-end refrain rather than a chorus.
//
// Disposable. Does not write SongSeed rows, does not consume hooks.

import { pickFormArchetype } from '../../src/lib/eno/form-archetype.js'
import { generateLyrics } from '../../src/lib/bernie/bernie.js'
import { PrismaClient } from '@prisma/client'

async function distributionTest(p: PrismaClient) {
  const outcomes = await p.outcome.findMany({
    where: { supersededAt: null },
    select: { outcomeKey: true, displayTitle: true, title: true },
    orderBy: [{ title: 'asc' }],
  })

  const eras = [1968, 1979, 1985, 1995, 2015]
  const N = 60

  console.log('\n==== SELECTOR DISTRIBUTION ====')
  console.log('60 picks per (outcome × era), no arrangementSections constraint\n')

  for (const o of outcomes) {
    const label = o.displayTitle ?? o.title
    const counts: Record<string, Record<string, number>> = {}
    for (const year of eras) {
      counts[year] = {}
      for (let i = 0; i < N; i++) {
        const choice = await pickFormArchetype({
          outcomeKey: o.outcomeKey,
          arrangementSections: null,
          referenceYear: year,
        })
        counts[year]![choice.slug] = (counts[year]![choice.slug] ?? 0) + 1
      }
    }
    console.log(`\n${label}`)
    const allSlugs = new Set<string>()
    for (const year of eras) Object.keys(counts[year]!).forEach((s) => allSlugs.add(s))
    const slugList = [...allSlugs].sort()
    const header = ['year'.padEnd(6), ...slugList.map((s) => s.padEnd(14))].join('')
    console.log(header)
    for (const year of eras) {
      const row = [String(year).padEnd(6), ...slugList.map((s) => String(counts[year]![s] ?? 0).padEnd(14))].join('')
      console.log(row)
    }
  }
}

async function bernieAabaTest(p: PrismaClient) {
  const aaba = await p.formArchetype.findUnique({ where: { slug: 'aaba' } })
  if (!aaba) {
    console.log('\n==== BERNIE AABA TEST: SKIPPED (no aaba row) ====')
    return
  }

  console.log('\n==== BERNIE AABA TEST ====')
  console.log('Hook: "Take the long way home tonight"')
  console.log('Archetype: aaba (no [Chorus] — hook should land as last line of every verse)\n')

  const out = await generateLyrics({
    hookText: 'Take the long way home tonight',
    brandLyricGuidelines: null,
    arrangementSections: null,
    formArchetype: {
      id: aaba.id,
      slug: aaba.slug,
      displayName: aaba.displayName,
      sectionList: aaba.sectionList,
      shapeNote: aaba.shapeNote,
    },
  })

  console.log(`Title: ${out.title}`)
  console.log(`Draft prompt version used: ${out.draftPromptVersion}`)
  console.log(`Edit prompt version used: ${out.editPromptVersion}`)
  console.log('\n--- Lyrics ---')
  console.log(out.lyrics)
  console.log('--- /Lyrics ---\n')

  // Quick structural assertions
  const lower = out.lyrics.toLowerCase()
  const hasChorus = /\[chorus\]|\[final chorus\]/i.test(out.lyrics)
  const verseCount = (out.lyrics.match(/\[verse/gi) ?? []).length
  const bridgeCount = (out.lyrics.match(/\[bridge\]/gi) ?? []).length
  const hookCount = (out.lyrics.match(/take the long way home tonight/gi) ?? []).length
  console.log('Structural check:')
  console.log(`  has [Chorus] section?     ${hasChorus} (expected: false for AABA)`)
  console.log(`  [Verse] sections:         ${verseCount} (expected: 3)`)
  console.log(`  [Bridge] sections:        ${bridgeCount} (expected: 1)`)
  console.log(`  hook occurrences:         ${hookCount} (expected: 3 — last line of each verse)`)
  void lower
}

;(async () => {
  const p = new PrismaClient()
  try {
    await distributionTest(p)
    await bernieAabaTest(p)
  } finally {
    await p.$disconnect()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
