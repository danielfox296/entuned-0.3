// Shared helpers for the Music Professor module. Split out from
// `music-professor.ts` so the runner stays focused on the single
// Anthropic call.

import { prisma } from '../../db.js'
import { MUSIC_PROFESSOR_PERSONA_SEED, MUSIC_PROFESSOR_MODULE_SEEDS } from './seeds.js'

export async function getOrSeedPersona(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.musicProfessorPersona.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.musicProfessorPersona.create({
    data: { version: 1, promptText: MUSIC_PROFESSOR_PERSONA_SEED, notes: 'Auto-seeded v1' },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}

export interface MusicProfessorModuleRow {
  id: string
  name: string
  body: string
  sortOrder: number
  tier: string
}

// Loads active modules, sorted by sortOrder. Cold-starts the seed list on
// first call when the table is empty. After the seed pass, the DB is the
// source of truth — operators add/remove/reorder through Dash.
//
// `untested` tier rows are excluded from the curriculum block even when
// active — they're a staging area for prompts the operator is drafting
// but not ready to ship.
export async function loadActiveModules(): Promise<MusicProfessorModuleRow[]> {
  const rows = await prisma.musicProfessorModule.findMany({
    where: { active: true, tier: { not: 'untested' } },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, body: true, sortOrder: true, tier: true },
  })
  if (rows.length > 0) return rows

  const totalCount = await prisma.musicProfessorModule.count()
  if (totalCount > 0) return []

  await prisma.musicProfessorModule.createMany({
    data: MUSIC_PROFESSOR_MODULE_SEEDS.map((s) => ({
      name: s.name,
      body: s.body,
      sortOrder: s.sortOrder,
      tier: s.tier,
      active: true,
    })),
  })
  return prisma.musicProfessorModule.findMany({
    where: { active: true, tier: { not: 'untested' } },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, body: true, sortOrder: true, tier: true },
  })
}

export interface GenreGravityRuleRow {
  tag: string
  counterExclusions: string[]
}

// Loads active genre gravity rules. No cold-start seeds — the table starts
// empty and operators populate it from real Suno output observations
// ("soft rock pulled toward smooth jazz again"). Empty table is a no-op
// for the genre-gravity module.
export async function loadGenreGravityRules(): Promise<GenreGravityRuleRow[]> {
  return prisma.genreGravityRule.findMany({
    where: { active: true },
    orderBy: { gravity: 'desc' },
    select: { tag: true, counterExclusions: true },
  })
}

// Renders the active modules into a single curriculum block injected into
// the Music Professor's system prompt. Modules are numbered for stable
// internal reference when the model emits changeLog tags, but the names
// (not numbers) are what the changeLog should cite.
export function formatCurriculumBlock(modules: MusicProfessorModuleRow[]): string {
  if (modules.length === 0) return ''
  const sections = modules.map((m, i) => `### ${i + 1}. ${m.name}\n${m.body}`).join('\n\n')
  return `\n\nCurriculum modules — read every token list through all of these simultaneously:\n\n${sections}\n`
}

// Renders the genre-gravity table as a structured block the model can
// scan during the genre-gravity module. Empty table renders nothing — the
// genre-gravity module becomes a no-op until the operator populates it.
export function formatGenreGravityBlock(rules: GenreGravityRuleRow[]): string {
  if (rules.length === 0) return ''
  const lines = rules.map((r) => {
    const excl = r.counterExclusions.length > 0 ? r.counterExclusions.join(', ') : '(none configured)'
    return `- "${r.tag}" → ${excl}`
  })
  return `\n\nGenre gravity rules — apply the genre-gravity module against this table:\n${lines.join('\n')}\n`
}
