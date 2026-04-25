// Seed FailureRule v1 from CARD_5_PROPOSAL.md / schema/light-cards.md.
// Idempotent — wipes failure_rules and re-inserts.

import 'dotenv/config'
import { prisma } from '../src/db.js'

interface SeedRule {
  triggerField: string
  triggerValue: string
  exclude: string
  overrideField?: string
  overridePattern?: string
  note: string
}

const V1_RULES: SeedRule[] = [
  // --- Conditional ---
  { triggerField: 'era_production_signature', triggerValue: '196', exclude: 'modern production, polished, bright high end, glossy mix', note: 'pre-1990 era → no high-end shine' },
  { triggerField: 'era_production_signature', triggerValue: '197', exclude: 'modern production, polished, bright high end, glossy mix', note: 'pre-1990 era → no high-end shine' },
  { triggerField: 'era_production_signature', triggerValue: '198', exclude: 'gated reverb cliché, anthemic stadium polish', note: '80s drift toward stadium pop-rock' },
  { triggerField: 'vibe_pitch', triggerValue: 'alt-country', exclude: 'twangy country, honky-tonk steel guitar, Nashville', note: 'alt-country drift toward country' },
  { triggerField: 'vibe_pitch', triggerValue: 'americana', exclude: 'twangy country, honky-tonk steel guitar, Nashville', note: 'americana drift toward country' },
  { triggerField: 'vibe_pitch', triggerValue: 'southern', exclude: 'country, Nashville, pedal steel, modern rock, gated reverb', note: 'seeds from Ronson southern-rock exclude_list' },
  { triggerField: 'vibe_pitch', triggerValue: 'roots', exclude: 'twangy country, honky-tonk steel guitar', note: 'roots drift toward country' },
  { triggerField: 'era_production_signature', triggerValue: 'soft rock', exclude: 'mellow generic, sanitized, neutered', note: '70s soft rock centroid' },
  { triggerField: 'instrumentation_palette', triggerValue: 'rhodes', exclude: 'clean Rhodes, sparkling Rhodes', note: 'always-clean Rhodes default; positive style should add Rhodes with overdrive' },
  { triggerField: 'arrangement_shape', triggerValue: 'extended', exclude: 'trim to standard length', note: 'Suno trims long sections' },
  { triggerField: 'arrangement_shape', triggerValue: 'monoton', exclude: 'trim to standard length', note: 'matches monotonous / monotony' },
  { triggerField: 'dynamic_curve', triggerValue: 'build', exclude: 'flat dynamic, consistent energy throughout', note: 'preserve build curves' },
  { triggerField: 'dynamic_curve', triggerValue: 'abandon', exclude: 'flat dynamic, consistent energy throughout', note: 'preserve expressive release' },

  // --- Unconditional ---
  { triggerField: '*', triggerValue: '', exclude: 'live audience, crowd applause, crowd noise', note: 'Suno spuriously inserts crowd noise' },
  {
    triggerField: '*',
    triggerValue: '',
    exclude: 'autotuned vocal, pitch-corrected vocal',
    overrideField: 'vocal_character',
    overridePattern: 'autotune',
    note: 'Suno autotune default; skip when vocal_character explicitly says autotuned',
  },
  {
    triggerField: '*',
    triggerValue: '',
    exclude: 'wash of ambient pads, generic pad layer',
    overrideField: 'instrumentation_palette',
    overridePattern: 'pad',
    note: 'pad-wash default; skip when instrumentation_palette mentions pads',
  },
  { triggerField: '*', triggerValue: '', exclude: 'Billie Eilish whispered vocal', note: 'breathy-whisper vocal default' },
  { triggerField: '*', triggerValue: '', exclude: 'generic genre centroid, sanitized, polished', note: 'the chaos-up principle' },
]

async function main() {
  // Wipe and re-insert.
  await prisma.failureRule.deleteMany({})
  await prisma.failureRule.createMany({ data: V1_RULES })

  // Seed StyleTemplate v1 row (provenance only — actual template lives in code).
  await prisma.styleTemplate.upsert({
    where: { version: 1 },
    update: {},
    create: {
      version: 1,
      templateText: '(see src/lib/mars/style-template-v1.ts) — outcome prepend + era + instruments + standout + vocals + groove, comma-joined.',
      notes: 'v1 deterministic Mars assembler',
    },
  })

  console.log(`Seeded ${V1_RULES.length} failure rules.`)
  console.log(`StyleTemplate v1 row ready.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
