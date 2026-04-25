// Generate two Suno-ready submissions for the same track + outcome + hook:
//   FULL    — current Mars assembly (~1200 chars)
//   COMPACT — reduced field set (~600 chars)
// Same lyrics, same vocal_gender, same negative_style. The only thing that varies
// is the style portion's length and field selection.
//
//   pnpm tsx scripts/compare-modes.ts \
//     --artist "..." --title "..." --year 1968 \
//     --outcome "Brand Reinforcement" \
//     --hook "Coming home to a Sunday afternoon" \
//     [--notes "..."]

import 'dotenv/config'
import { decompose } from '../src/lib/decomposer/decomposer.js'
import { marsAssemble } from '../src/lib/mars/mars.js'
import { assembleCompactStyle } from '../src/lib/mars/style-template-compact.js'
import { generateLyrics } from '../src/lib/proto-bernie/lyrics.js'
import { prisma } from '../src/db.js'
import type { Decomposition } from '@prisma/client'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const artist = arg('artist')
  const title = arg('title')
  const year = arg('year') ? parseInt(arg('year')!, 10) : undefined
  const outcomeTitle = arg('outcome') ?? 'Brand Reinforcement'
  const hookText = arg('hook') ?? 'Coming home to a Sunday afternoon'
  const operatorNotes = arg('notes')

  if (!artist || !title) {
    console.error('usage: pnpm tsx scripts/compare-modes.ts --artist "..." --title "..." [--year 1968] [--outcome "..."] [--hook "..."] [--notes "..."]')
    process.exit(1)
  }

  const outcome = await prisma.outcome.findFirst({
    where: { title: outcomeTitle, supersededAt: null },
    orderBy: { version: 'desc' },
  })
  if (!outcome) throw new Error(`No outcome titled "${outcomeTitle}"`)

  // Look up Untuckit's brand lyric guidelines (only one Client today).
  const client = await prisma.client.findFirst()
  const brandLyricGuidelines = client?.brandLyricGuidelines ?? null

  // 1. Decompose.
  console.log(`Decomposing ${artist} — ${title}…`)
  const dec = await decompose({ artist, title, year, operatorNotes })

  const decompositionForMars = {
    id: 'in-memory',
    referenceTrackId: 'in-memory',
    musicologicalRulesVersion: dec.rulesVersion,
    status: 'draft',
    verifiedAt: null,
    verifiedById: null,
    confidence: dec.output.confidence,
    vibePitch: dec.output.vibe_pitch,
    eraProductionSignature: dec.output.era_production_signature,
    instrumentationPalette: dec.output.instrumentation_palette,
    standoutElement: dec.output.standout_element,
    arrangementShape: dec.output.arrangement_shape,
    dynamicCurve: dec.output.dynamic_curve,
    // If decomposer-v3 reported gender explicitly, prepend it to vocal_character so
    // Mars's matcher picks it up without needing to know the field exists.
    vocalCharacter: dec.output.vocal_gender
      ? `${dec.output.vocal_gender} vocal — ${dec.output.vocal_character}`
      : dec.output.vocal_character,
    vocalArrangement: dec.output.vocal_arrangement,
    harmonicAndGroove: dec.output.harmonic_and_groove,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Decomposition

  // 2. Mars (shared: negative_style, vocal_gender, fired rules).
  // Outcome is no longer used in style assembly (its physiology lives on Suno's other params).
  console.log(`Mars assembling…`)
  const fullMars = await marsAssemble(decompositionForMars)
  const compactStyle = assembleCompactStyle({ decomposition: decompositionForMars })

  // 3. Lyrics (proto-Bernie, single pass, shared between both versions).
  console.log(`Generating lyrics around hook…`)
  const lyrics = await generateLyrics({ hookText, brandLyricGuidelines })

  // ----- Output -----
  const sep = '═'.repeat(70)
  const minor = '─'.repeat(70)

  console.log(`\n${sep}`)
  console.log(`SHARED (both versions)`)
  console.log(`${sep}`)
  console.log(`Title       : ${lyrics.title}`)
  console.log(`Vocal gender: ${fullMars.vocalGender}`)
  console.log(`Negative    : (${fullMars.negativeStyle.length} chars) ${fullMars.negativeStyle}`)
  console.log(`Lyrics      :`)
  console.log(indent(lyrics.lyrics, '  '))

  console.log(`\n${sep}`)
  console.log(`VERSION A — FULL  (${fullMars.style.length} chars)`)
  console.log(`${sep}`)
  console.log(`Style:`)
  console.log(wrap(fullMars.style, 68, '  '))

  console.log(`\n${sep}`)
  console.log(`VERSION B — COMPACT  (${compactStyle.length} chars)`)
  console.log(`${sep}`)
  console.log(`Style:`)
  console.log(wrap(compactStyle, 68, '  '))

  console.log(`\n${minor}`)
  console.log(`Provenance: decomposer v${dec.rulesVersion}, style template v${fullMars.styleTemplateVersion},`)
  console.log(`            ${fullMars.firedFailureRuleIds.length} failure rules fired`)
}

function indent(s: string, prefix: string): string {
  return s.split('\n').map((l) => prefix + l).join('\n')
}

function wrap(s: string, width: number, ind: string): string {
  const words = s.split(/\s+/)
  const lines: string[] = []
  let line = ind
  for (const w of words) {
    if (line.length + w.length + 1 > width + ind.length && line.trim()) {
      lines.push(line)
      line = ind + w
    } else {
      line += (line === ind ? '' : ' ') + w
    }
  }
  if (line.trim()) lines.push(line)
  return lines.join('\n')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
