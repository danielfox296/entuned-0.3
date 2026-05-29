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

interface Section {
  label: string         // bare section name; brackets added when rendered to Bernie
  optional?: boolean
  arc: string           // the stanza's job + relationship to the hook + space character
}

interface ArchetypeSeed {
  slug: string
  displayName: string
  sections: Section[]   // ordered, per-occurrence (Verse 1 ≠ Verse 2; each Chorus its own arc)
  shapeNote: string
  requiresSections: string[]
  outcomeWeightsByTitle: Record<string, number>  // resolved to outcome_keys at seed time
  defaultWeight: number  // becomes the "*" entry
  eraWeights?: { ranges: Array<{ minYear?: number; maxYear?: number; weight: number }> }
}

// Outcome-title keys below use the Outcome.title field (LLM-load-bearing internal
// name), not displayTitle. The seed's keyByTitle map accepts either, but titles
// stay stable across display-name renames. Current canonical titles (2026-05-23):
//   Free tier: Chill, Steady, Upbeat
//   Boost tier: Dwell Extension, Browse to Buy, Value Lift, Add Items, Impulse,
//               Dwell Compression, Brand Match, Status Lift
const ARCHETYPES: ArchetypeSeed[] = [
  {
    slug: 'vcvcbc',
    displayName: 'V-C-V-C-Bridge-Final C (current default)',
    sections: [
      { label: 'Intro', optional: true, arc: "The Frame — near-wordless. If any words, one short phrase that hints at the hook's world. Leave most of it to the music." },
      { label: 'Verse 1', arc: "Establish-and-Lean — set one plain scene with the narrator acting. End leaning toward the chorus. Leave a line short." },
      { label: 'Pre-Chorus', optional: true, arc: "The Lift — tighten and rise, short pushing lines, energy aimed at the chorus. End unresolved." },
      { label: 'Chorus', arc: "Thesis — state the song's one idea, clean and finished. Plain words, room around it. Say it and let it ring. Hook verbatim." },
      { label: 'Verse 2', arc: "The Turn — don't restate Verse 1; later moment or harder truth. Make the hook mean something new when it returns. Stay bare." },
      { label: 'Pre-Chorus', optional: true, arc: "The Lift — same rise as before, a touch more pressure. End unresolved." },
      { label: 'Chorus', arc: "Thesis — hook verbatim again. Same words, now carrying Verse 2's weight." },
      { label: 'Bridge', arc: "Reframe — step outside the frame: new image, new stance, the line the verses avoided. Barest section. Resolve back toward the hook." },
      { label: 'Final Chorus', arc: "Thesis-Plus — same hook, heaviest landing. Identical words, earned. No new lines." },
      { label: 'Outro', optional: true, arc: "The Landing — hook fragment, sustained, like the last thing said before the lights go. No new ideas." },
    ],
    shapeNote: 'Standard pop arc — two verse-chorus cycles, a bridge that contrasts in image or stance, then a final chorus that lands. The hook is the chorus, sung verbatim each time including in the Final Chorus.',
    requiresSections: [],
    outcomeWeightsByTitle: {},
    defaultWeight: 1,
  },
  {
    slug: 'vcvc',
    displayName: 'V-C-V-C (no bridge)',
    sections: [
      { label: 'Verse 1', arc: "Cold Open — start mid-action, no wind-up. One image, then stop. Point at the hook without naming it." },
      { label: 'Pre-Chorus', optional: true, arc: "The Lift — tighten and rise, all energy at the chorus. End unresolved." },
      { label: 'Chorus', arc: "Thesis — state the one idea, clean and finished. Plain words, room around it. Hook verbatim." },
      { label: 'Verse 2', arc: "The Turn — move, don't restate: push the situation forward fast. Recolor the hook. Stay bare." },
      { label: 'Pre-Chorus', optional: true, arc: "The Lift — same rise, more drive into the last chorus." },
      { label: 'Chorus', arc: "Thesis-Plus — hook verbatim, final landing; the verses have raised the stakes, so it hits harder. No new lines." },
    ],
    shapeNote: 'Two clean verse-chorus cycles, no bridge, no escalated final. Ends on the second chorus. Songs feel direct and uninterrupted — good for movement and momentum, bad for songs that need a contrast moment. A Pre-Chorus may appear before either chorus when the verse needs a lift into the hook.',
    requiresSections: [],
    outcomeWeightsByTitle: {
      'Dwell Compression': 3,
      'Impulse': 2,
      'Browse to Buy': 2,
      'Add Items': 1,
    },
    defaultWeight: 1,
  },
  {
    slug: 'aaba',
    displayName: 'AABA (verse-verse-bridge-verse, no chorus)',
    sections: [
      { label: 'Verse 1', arc: "Refrain-Land — one quiet, conversational scene, narrator acting. Walk up to the closing hook line so it lands clean. Single sustained mood. The hook is the final line." },
      { label: 'Verse 2', arc: "Refrain-Land via The Turn — new moment, same mood; don't restate Verse 1. Arrive at the identical closing hook line from a different place." },
      { label: 'Bridge', arc: "Reframe — the only section without the hook. Shift the angle, name the tension underneath, stay bare, then resolve so Verse 3 can return home." },
      { label: 'Verse 3', arc: "Refrain-Land via Thesis-Plus — come back to the world of Verse 1, changed by the bridge. Land the same closing hook line one last time, heaviest. No new closing line." },
    ],
    shapeNote: 'Tin Pan Alley / standards form. There is NO labeled Chorus and NO Pre-Chorus. The hook lives as the LAST LINE of every Verse — write each verse to land on the hook verbatim as a refrain. The Bridge is the only section without the hook; it contrasts and then resolves back into Verse 3. This form rewards quiet, conversational lyrics and a single sustained mood.',
    requiresSections: [],
    outcomeWeightsByTitle: {
      'Dwell Extension': 3,
      'Chill': 2,
      'Steady': 2,
      'Brand Match': 1,
    },
    defaultWeight: 0,
  },
  {
    slug: 'intro_driven',
    displayName: 'Intro-driven (long intro, fewer choruses)',
    sections: [
      { label: 'Intro', arc: "Arrival — extended, ~8-12 bars; the lyric is a moment already happening, not a build-up. Set the one image we've arrived at, plainly, and hold it. Short. Don't explain how we got here." },
      { label: 'Verse 1', arc: "Arrival (compact) — stay in the arrived moment; narrator doing one small thing. Keep it short and plain. Lean toward the chorus." },
      { label: 'Pre-Chorus', optional: true, arc: "The Coil — pull back and compress, a held breath before the hook. Fewer words." },
      { label: 'Chorus', arc: "Thesis — state the one idea, clean and finished. Room around it. Hook verbatim." },
      { label: 'Verse 2', arc: "Deepen-Inward — same arrived place, now from the inside: what the narrator feels, said plainly. One thought. Keep it short." },
      { label: 'Pre-Chorus', optional: true, arc: "The Coil — same held breath into the chorus." },
      { label: 'Chorus', arc: "Thesis-Plus — hook verbatim, final landing." },
    ],
    shapeNote: 'Front-loaded. The intro establishes the song before any words arrive. Verses are short, chorus repeats only twice, no bridge. The lyric should feel like an arrival rather than a build. A Pre-Chorus may appear before either chorus when the verse asks for a lift into the hook.',
    requiresSections: [],
    outcomeWeightsByTitle: {
      'Brand Match': 3,
      'Chill': 2,
      'Dwell Extension': 2,
      'Steady': 1,
    },
    defaultWeight: 1,
  },
  {
    slug: 'loop',
    displayName: 'Loop (groove-driven, instrumental break)',
    sections: [
      { label: 'Intro', arc: "The Frame — groove establishes. Wordless or one short phrase, repeated. Leave it to the pocket." },
      { label: 'Verse 1', arc: "Pocket-Phrase — serve the groove. Short rhythmic lines, repeated and nudged. Say little, say it tight, leave space for the beat." },
      { label: 'Pre-Chorus', optional: true, arc: "The Lift — a short rhythmic ramp into the hook. Tighter, one repeated push." },
      { label: 'Chorus', arc: "The Mantra — one short hook phrase, held and turned slightly each pass. Repetition is the meaning: circle, don't develop." },
      { label: 'Instrumental Break', arc: "The Frame — no new lyric, or one fragment echoing the hook. Hand it to the groove." },
      { label: 'Chorus', arc: "The Echo — re-enter on the same hook like returning to a familiar room; slightly more lived-in, same words." },
      { label: 'Outro', optional: true, arc: "The Mantra — fade on the hook phrase, smaller each pass. No new words." },
    ],
    shapeNote: 'Dance/groove logic. One verse, one chorus, an instrumental break where the groove takes over, then the chorus returns and the song fades or stops cold. Lyrics should be tight and rhythmic — the song carries on the pocket, not the words. No bridge, no second verse.',
    requiresSections: [],
    outcomeWeightsByTitle: {
      'Upbeat': 2,
      'Dwell Compression': 2,
      'Impulse': 2,
      'Status Lift': 1,
    },
    defaultWeight: 1,
    eraWeights: {
      ranges: [
        { minYear: 1975, maxYear: 1985, weight: 1.5 },
        { minYear: 2010, weight: 1.5 },
      ],
    },
  },
  {
    slug: 'tag_out',
    displayName: 'Tag-out (half-time tag at the end)',
    sections: [
      { label: 'Verse 1', arc: "Establish-and-Lean — one plain scene, narrator acting. End leaning toward the chorus. Leave a line short." },
      { label: 'Pre-Chorus', optional: true, arc: "The Lift — tighten and rise into the chorus. End unresolved." },
      { label: 'Chorus', arc: "Thesis — state the one idea, clean and finished. Room around it. Hook verbatim." },
      { label: 'Verse 2', arc: "The Turn — don't restate; deeper or later. Recolor the hook. Stay bare." },
      { label: 'Pre-Chorus', optional: true, arc: "The Lift — same rise, more heat." },
      { label: 'Chorus', arc: "Thesis — hook verbatim, carrying Verse 2's weight." },
      { label: 'Bridge', arc: "The Confession — drop the guard: admit the one thing underneath, once, undecorated. Return toward the hook changed." },
      { label: 'Final Chorus', arc: "Thesis-Plus — same hook, biggest landing before the slowdown." },
      { label: 'Tag', arc: "The Landing — half-time, hook only, sustained. Repeat the hook as a sustained tag, a preacher landing the last line. No new words, all weight and air." },
    ],
    shapeNote: 'Soul / 60s-70s logic. After the final chorus, the song slows to half-time and repeats the hook as a sustained tag — like a preacher landing the last line. The Tag section is hook-only, no new lyrics. The rest of the song is a standard arc. A Pre-Chorus may appear before either chorus when the verse asks for a lift into the hook.',
    requiresSections: [],
    outcomeWeightsByTitle: {
      'Upbeat': 2,
      'Dwell Extension': 2,
      'Status Lift': 2,
      'Brand Match': 1,
      'Value Lift': 1,
    },
    defaultWeight: 1,
    eraWeights: {
      ranges: [
        { minYear: 1965, maxYear: 1979, weight: 1.5 },
      ],
    },
  },
]

async function main() {
  const p = new PrismaClient()
  try {
    // Resolve outcome_keys by display title or title (active versions only).
    // displayTitle is the operator-facing name (Calm, Linger, ...); title is
    // the LLM-load-bearing internal name (Arousal Down, Dwell Extension, ...).
    // The seed lists use display titles since they're the human-readable form.
    const outcomes = await p.outcome.findMany({
      where: { supersededAt: null },
      select: { outcomeKey: true, title: true, displayTitle: true },
    })
    const keyByTitle = new Map<string, string>()
    for (const o of outcomes) {
      if (o.displayTitle) keyByTitle.set(o.displayTitle, o.outcomeKey)
      keyByTitle.set(o.title, o.outcomeKey)
    }

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
            sections: a.sections as unknown as Prisma.InputJsonValue,
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
            sections: a.sections as unknown as Prisma.InputJsonValue,
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
