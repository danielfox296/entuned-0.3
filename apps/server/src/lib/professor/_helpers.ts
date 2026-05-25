// Shared helpers for the Professor module. Split out from `professor.ts` so
// the runner stays focused on the single Anthropic call.

import { prisma } from '../../db.js'
import { PROFESSOR_PERSONA_SEED, PROFESSOR_MODULE_SEEDS } from './seeds.js'

export async function getOrSeedPersona(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.professorPersona.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.professorPersona.create({
    data: { version: 1, promptText: PROFESSOR_PERSONA_SEED, notes: 'Auto-seeded v1' },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}

export interface ProfessorModuleRow {
  id: string
  name: string
  body: string
  sortOrder: number
}

// Loads active modules, sorted by sortOrder. Cold-starts the seed list on
// first call when the table is empty. After the seed pass, the DB is the
// source of truth — operators add/remove/reorder through Dash and the
// constants in seeds.ts are never read again.
export async function loadActiveModules(): Promise<ProfessorModuleRow[]> {
  const rows = await prisma.professorModule.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, body: true, sortOrder: true },
  })
  if (rows.length > 0) return rows

  // First-run seeding: insert all seed modules iff the table is completely empty.
  // Re-check after insert to handle a deactivated-everything operator state
  // (table populated but no active rows) — in that case we return [] and the
  // Professor runs with persona only.
  const totalCount = await prisma.professorModule.count()
  if (totalCount > 0) return []

  await prisma.professorModule.createMany({
    data: PROFESSOR_MODULE_SEEDS.map((s) => ({
      name: s.name,
      body: s.body,
      sortOrder: s.sortOrder,
      active: true,
    })),
  })
  return prisma.professorModule.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, body: true, sortOrder: true },
  })
}

// Renders the active modules into a single curriculum block injected into the
// Professor's system prompt. Modules are numbered for stable internal reference
// when the model emits changeLog tags, but the names (not numbers) are what
// the changeLog should cite.
export function formatCurriculumBlock(modules: ProfessorModuleRow[]): string {
  if (modules.length === 0) return ''
  const sections = modules.map((m, i) => `### ${i + 1}. ${m.name}\n${m.body}`).join('\n\n')
  return `\n\nCurriculum modules — read every line through all of these simultaneously:\n\n${sections}\n`
}
