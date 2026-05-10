// Seed the 6 v1 form archetypes. Idempotent — re-running upserts by slug.
// Per-outcome weights are bound to outcome_key at seed time by looking up
// outcomes by title; the JSON in the DB stores stable outcome_keys so weights
// survive outcome re-versioning. Operators tune everything live in Dash →
// Prompts & Rules → Form Archetypes.
//
// Usage (from monorepo root):
//   cd entuned-0.3 && railway up --detach
//   railway ssh "cd /app && node --import tsx -e \"
//     import('file:///app/prisma/seed/seed-form-archetypes.ts');
//   \""

import { PrismaClient, Prisma } from '@prisma/client'

interface ArchetypeSeed {
  slug: string
  displayName: string
  sectionList: string
  shapeNote: string
  requiresSections: string[]
  outcomeWeightsByTitle: Record<string, number>  // resolved to outcome_keys at seed time
  defaultWeight: number  // becomes the "*" entry
  eraWeights?: { ranges: Array<{ minYear?: number; maxYear?: number; weight: number }> }
}

const ARCHETYPES: ArchetypeSeed[] = [
  {
    slug: 'vcvcbc',
    displayName: 'V-C-V-C-Bridge-Final C (current default)',
    sectionList: '[Intro] (optional), [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Final Chorus], [Outro] (optional)',
    shapeNote: 'Standard pop arc — two verse-chorus cycles, a bridge that contrasts in image or stance, then a final chorus that lands. The hook is the chorus, sung verbatim each time including in [Final Chorus].',
    requiresSections: [],
    outcomeWeightsByTitle: {},
    defaultWeight: 1,
  },
  {
    slug: 'vcvc',
    displayName: 'V-C-V-C (no bridge)',
    sectionList: '[Verse 1], [Chorus], [Verse 2], [Chorus]',
    shapeNote: 'Two clean verse-chorus cycles, no bridge, no escalated final. Ends on the second chorus. Songs feel direct and uninterrupted — good for movement and momentum, bad for songs that need a contrast moment.',
    requiresSections: [],
    outcomeWeightsByTitle: { 'Move Through': 3, 'Impulse Buy': 2, 'Convert Browsers': 2 },
    defaultWeight: 1,
  },
  {
    slug: 'aaba',
    displayName: 'AABA (verse-verse-bridge-verse, no chorus)',
    sectionList: '[Verse 1], [Verse 2], [Bridge], [Verse 3]',
    shapeNote: 'Tin Pan Alley / standards form. There is NO labeled [Chorus]. The hook lives as the LAST LINE of every [Verse] section — write each verse to land on the hook verbatim as a refrain. The [Bridge] is the only section without the hook; it contrasts in image or stance and then resolves back into [Verse 3]. This form rewards quiet, conversational lyrics and a single sustained mood.',
    requiresSections: [],
    outcomeWeightsByTitle: { 'Linger': 3, 'Calm': 2, 'Reinforce Brand': 1 },
    defaultWeight: 0,
  },
  {
    slug: 'intro_driven',
    displayName: 'Intro-driven (long intro, fewer choruses)',
    sectionList: '[Intro] (extended — sets the mood for ~8-12 bars before any vocal), [Verse 1], [Chorus], [Verse 2], [Chorus]',
    shapeNote: 'Front-loaded. The intro establishes the song before any words arrive. Verses are short, chorus repeats only twice, no bridge. The lyric should feel like an arrival rather than a build — the listener has already been inside the world for a while when the first verse lands.',
    requiresSections: [],
    outcomeWeightsByTitle: { 'Reinforce Brand': 3, 'Calm': 2, 'Linger': 1 },
    defaultWeight: 1,
  },
  {
    slug: 'loop',
    displayName: 'Loop (groove-driven, instrumental break)',
    sectionList: '[Intro] (groove establishes), [Verse 1], [Chorus], [Instrumental Break], [Chorus], [Outro]',
    shapeNote: 'Dance/groove logic. One verse, one chorus, an instrumental break where the groove takes over, then the chorus returns and the song fades or stops cold. Lyrics should be tight and rhythmic — the song carries on the pocket, not the words. No bridge. No second verse.',
    requiresSections: [],
    outcomeWeightsByTitle: { 'Lift Energy': 2, 'Move Through': 2, 'Impulse Buy': 2 },
    defaultWeight: 1,
    eraWeights: {
      ranges: [
        { minYear: 1975, maxYear: 1985, weight: 2 },
        { minYear: 2010, weight: 2 },
      ],
    },
  },
  {
    slug: 'tag_out',
    displayName: 'Tag-out (half-time tag at the end)',
    sectionList: '[Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Final Chorus], [Tag] (half-time, hook only, sustained)',
    shapeNote: 'Soul / 60s-70s logic. After the final chorus, the song slows to half-time and repeats the hook (verbatim) as a sustained tag — like a preacher landing the last line. The [Tag] section is hook-only, no new lyrics. The rest of the song is a standard arc.',
    requiresSections: [],
    outcomeWeightsByTitle: { 'Lift Energy': 2, 'Linger': 2, 'Reinforce Brand': 1 },
    defaultWeight: 1,
    eraWeights: {
      ranges: [
        { minYear: 1965, maxYear: 1979, weight: 2 },
      ],
    },
  },
]

async function main() {
  const p = new PrismaClient()
  try {
    // Resolve outcome_keys by title (active versions only).
    const outcomes = await p.outcome.findMany({
      where: { supersededAt: null },
      select: { outcomeKey: true, title: true },
    })
    const keyByTitle = new Map(outcomes.map((o) => [o.title, o.outcomeKey]))

    let created = 0
    let updated = 0
    for (const a of ARCHETYPES) {
      const outcomeWeights: Record<string, number> = { '*': a.defaultWeight }
      for (const [title, weight] of Object.entries(a.outcomeWeightsByTitle)) {
        const key = keyByTitle.get(title)
        if (!key) {
          console.warn(`  archetype ${a.slug}: outcome "${title}" not found in DB — skipping weight`)
          continue
        }
        outcomeWeights[key] = weight
      }

      const existing = await p.formArchetype.findUnique({ where: { slug: a.slug } })
      if (existing) {
        await p.formArchetype.update({
          where: { slug: a.slug },
          data: {
            displayName: a.displayName,
            sectionList: a.sectionList,
            shapeNote: a.shapeNote,
            requiresSections: a.requiresSections,
            outcomeWeights,
            eraWeights: a.eraWeights ?? Prisma.JsonNull,
            isActive: true,
          },
        })
        updated++
        console.log(`  updated ${a.slug}`)
      } else {
        await p.formArchetype.create({
          data: {
            slug: a.slug,
            displayName: a.displayName,
            sectionList: a.sectionList,
            shapeNote: a.shapeNote,
            requiresSections: a.requiresSections,
            outcomeWeights,
            eraWeights: a.eraWeights ?? Prisma.JsonNull,
            isActive: true,
          },
        })
        created++
        console.log(`  created ${a.slug}`)
      }
    }
    console.log(`Done. ${created} created, ${updated} updated.`)
  } finally {
    await p.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
