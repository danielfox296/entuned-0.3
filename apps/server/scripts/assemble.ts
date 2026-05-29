// End-to-end assembler: take a reference track + an outcome → run decomposer → run Mars
// → print the Suno style + negative_style + vocal_gender as it would land in a Submission.
//
//   pnpm tsx scripts/assemble.ts \
//     --artist "..." --title "..." --year 1968 \
//     --outcome "Brand Reinforcement" \
//     [--notes "kick sidechained, flammed snare"] \
//     [--genre southern-rock]

import 'dotenv/config'
import { decompose, toStyleAnalysisData } from '../src/lib/decomposer/decomposer.js'
import { marsAssemble } from '../src/lib/mars/mars.js'
import { normalizeStyleAnalysis } from '../src/lib/eno/eno.js'
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
  const operatorNotes = arg('notes')
  const genreSlug = arg('genre')

  if (!artist || !title) {
    console.error('usage: pnpm tsx scripts/assemble.ts --artist "..." --title "..." [--year 1968] [--outcome "Brand Reinforcement"] [--notes "..."] [--genre southern-rock]')
    process.exit(1)
  }

  const outcome = await prisma.outcome.findFirst({ where: { title: outcomeTitle, supersededAt: null }, orderBy: { version: 'desc' } })
  if (!outcome) {
    console.error(`No active outcome found with title "${outcomeTitle}".`)
    process.exit(1)
  }

  console.log(`╭──────────────────────────────────────────────────────────────────╮`)
  console.log(`│ Assemble: ${artist} — ${title}${year ? ` (${year})` : ''}`.padEnd(67) + `│`)
  console.log(`│ Outcome: ${outcome.title} (v${outcome.version}) · ${outcome.tempoBpm} BPM · ${outcome.mode}`.padEnd(67) + `│`)
  if (operatorNotes) console.log(`│ Notes: ${operatorNotes.slice(0, 56)}${operatorNotes.length > 56 ? '…' : ''}`.padEnd(67) + `│`)
  console.log(`╰──────────────────────────────────────────────────────────────────╯`)

  // 1. Decompose.
  console.log(`\n[1/2] Decomposing track...`)
  const decompositionResult = await decompose({ artist, title, year, genreSlug, operatorNotes })
  console.log(`      Confidence: ${decompositionResult.output.confidence}`)
  if (decompositionResult.output.verifiable_facts) {
    console.log(`      Facts: ${decompositionResult.output.verifiable_facts}`)
  }

  // Coerce the LLM output shape into the Prisma Decomposition shape (camelCase fields)
  // for the Mars matcher. We don't write to the DB on this path — Mars works on objects.
  // Build the row the same way the production path does (shared mapper) and run it
  // through the v13 normalization shim so Mars reads structured-field rows correctly.
  const decompositionForMars = normalizeStyleAnalysis({
    id: 'in-memory',
    referenceTrackId: 'in-memory',
    ...toStyleAnalysisData(decompositionResult),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Decomposition)

  // 2. Mars.
  console.log(`\n[2/2] Mars assembling style...`)
  const mars = await marsAssemble(decompositionForMars)

  console.log(`\n══════════════════════════════════════════════════════════════════`)
  console.log(`SUNO SUBMISSION`)
  console.log(`══════════════════════════════════════════════════════════════════`)
  console.log(`\n▸ vocal_gender:`)
  console.log(`  ${mars.vocalGender}`)

  console.log(`\n▸ style (${mars.style.length} chars):`)
  console.log(wrap(mars.style, 66, '  '))

  console.log(`\n▸ negative_style (${mars.negativeStyle.length} chars):`)
  console.log(wrap(mars.negativeStyle, 66, '  '))

  console.log(`\n──────────────────────────────────────────────────────────────────`)
  console.log(`Provenance:`)
  console.log(`  decomposer rules version : v${decompositionResult.rulesVersion}`)
  console.log(`  style template version   : v${mars.styleTemplateVersion}`)
  console.log(`  failure rules fired      : ${mars.firedFailureRuleIds.length}`)
}

function wrap(s: string, width: number, indent: string): string {
  const words = s.split(/\s+/)
  const lines: string[] = []
  let line = indent
  for (const w of words) {
    if (line.length + w.length + 1 > width + indent.length && line.trim()) {
      lines.push(line)
      line = indent + w
    } else {
      line += (line === indent ? '' : ' ') + w
    }
  }
  if (line.trim()) lines.push(line)
  return lines.join('\n')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
