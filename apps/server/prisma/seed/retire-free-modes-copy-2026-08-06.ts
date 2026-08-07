// One-shot: push the Dwell repoint into the live EmailTemplate rows.
//
// Email bodies are DB-first (`lib/email.ts renderTemplate` reads
// `email_templates` and only falls back to the TS module when no row exists),
// so editing `src/email-templates/*.ts` alone is a prod no-op for any template
// an operator has already saved. This script rewrites the two sentences that
// named the retired Chill / Steady / Upbeat modes as the free-tier offering.
//
// Idempotent: each replacement is a literal swap that no longer matches once
// applied. Safe to re-run. Same shape as rename-outcome-dwell-2026-08-06.ts.
//
// Run: cd entuned-0.3 && railway ssh "cd /app && node dist/prisma/seed/retire-free-modes-copy-2026-08-06.js"
//      or locally against prod: tsx prisma/seed/retire-free-modes-copy-2026-08-06.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// [pattern, replacement]. Patterns tolerate the raw and HTML-escaped forms of
// the em dash / ampersand the bodies are authored with.
const REPLACEMENTS: [RegExp, string][] = [
  [
    /Pick Chill, Steady, or Upbeat\. Music starts\./g,
    'Music starts on Dwell &mdash; the outcome that holds browsers on the floor longer.',
  ],
  [
    /Chill, Steady, or Upbeat on a 100\+ song shared catalogue/g,
    'one outcome, Dwell, on a 100+ song shared catalogue',
  ],
  [/Pick a mode\. Music starts\./g, 'Music starts.'],
]

async function main() {
  const templates = await prisma.emailTemplate.findMany({
    select: { id: true, name: true, subject: true, body: true },
  })

  let touched = 0
  for (const t of templates) {
    let subject = t.subject
    let body = t.body
    for (const [pattern, replacement] of REPLACEMENTS) {
      // Fresh lastIndex per field — /g regexes are stateful across .replace()
      // only via .test(), but resetting keeps this obviously safe to reorder.
      pattern.lastIndex = 0
      subject = subject.replace(pattern, replacement)
      pattern.lastIndex = 0
      body = body.replace(pattern, replacement)
    }
    if (subject === t.subject && body === t.body) continue

    await prisma.emailTemplate.update({ where: { id: t.id }, data: { subject, body } })
    console.log(`✓  email template "${t.name}" updated`)
    touched++
  }

  if (touched === 0) {
    console.log('·  no email templates named the retired modes — nothing to do')
  }
  console.log(`\nDone — ${touched} email template(s) updated.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
