// One-shot: rename the "Stay & Browse" outcome's display name to "Dwell".
//
// Third display name for this row: Linger → Stay & Browse (2026-05-14) → Dwell.
// Matches against all known historical variants (case-insensitive) so it runs
// cleanly regardless of current displayTitle state, and is idempotent.
//
// Scope note: displayTitle ONLY. `Outcome.title` stays `Dwell Extension` (it is
// LLM-load-bearing and feeds the factor prompts), and `outcomeKey`/`id` are
// untouched, so no FK repoint is required. This is not a version bump.
//
// Also updates the one EmailTemplate row whose body names the outcome. Email
// bodies are DB-first — editing src/email-templates/*.ts alone is a prod no-op.
//
// Run: railway ssh "cd /app && node --input-type=module -e \"await import('file:///app/dist/...')\""
//      or locally against prod: tsx prisma/seed/rename-outcome-dwell-2026-08-06.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const VARIANTS = ['stay & browse', 'linger']
const NEW_DISPLAY_TITLE = 'Dwell'

async function main() {
  // ---- 1. Outcome display name -------------------------------------------
  const outcomes = await prisma.outcome.findMany({
    where: {
      supersededAt: null,
      OR: VARIANTS.flatMap((v) => [
        { title: { equals: v, mode: 'insensitive' as const } },
        { displayTitle: { equals: v, mode: 'insensitive' as const } },
      ]),
    },
    select: { id: true, title: true, displayTitle: true },
  })

  if (outcomes.length === 0) {
    console.warn(`⚠  No active outcome matched ${VARIANTS.join(' / ')} — nothing renamed.`)
  } else {
    await prisma.outcome.updateMany({
      where: { id: { in: outcomes.map((o) => o.id) } },
      data: { displayTitle: NEW_DISPLAY_TITLE },
    })
    for (const o of outcomes) {
      console.log(`✓  outcome "${o.displayTitle ?? o.title}" → "${NEW_DISPLAY_TITLE}" (title stays "${o.title}")`)
    }
  }

  // ---- 2. Email template bodies ------------------------------------------
  // Only templates that actually name the outcome. HTML-escaped ampersand.
  const templates = await prisma.emailTemplate.findMany({ select: { id: true, name: true, subject: true, body: true } })
  // Separate instances: a /g regex mutates lastIndex on .test(), which silently
  // skips matches when the same object is reused across calls.
  const TEST = /Stay\s*(?:&amp;|&)\s*Browse/i
  const REPLACE = /Stay\s*(?:&amp;|&)\s*Browse/gi

  let touched = 0
  for (const t of templates) {
    if (!TEST.test(t.body) && !TEST.test(t.subject)) continue
    await prisma.emailTemplate.update({
      where: { id: t.id },
      data: {
        subject: t.subject.replace(REPLACE, NEW_DISPLAY_TITLE),
        body: t.body.replace(REPLACE, NEW_DISPLAY_TITLE),
      },
    })
    console.log(`✓  email template "${t.name}" updated`)
    touched++
  }
  if (touched === 0) console.log('·  no email templates referenced the old name')

  console.log(`\nDone — ${outcomes.length} outcome(s), ${touched} email template(s).`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
