// One-shot: overwrite DB email templates from the TS seeds.
//
// Background: the boot-time `seedEmailTemplates()` in lib/email.ts only
// CREATES missing rows — it deliberately never overwrites operator edits.
// That's right behavior for normal startup. But it means a global copy
// pass to the seeds.ts file (e.g. brand-voice cleanup) doesn't propagate.
//
// This script DOES overwrite. Use after a seeds.ts edit that should
// supersede whatever's currently in the DB. Idempotent — running it twice
// is a no-op past the first run.
//
// Usage from monorepo root:
//   pnpm exec tsx apps/server/scripts/reseed-email-templates.ts
//
// Set `RESEED_TEMPLATES=name1,name2` to scope the overwrite. Empty (or
// unset) overwrites every template in EDITABLE_TEMPLATES.

import 'dotenv/config'
import { prisma } from '../src/db.js'
import { EDITABLE_TEMPLATES } from '../src/email-templates/seeds.js'

async function main() {
  const filter = (process.env.RESEED_TEMPLATES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const updated: string[] = []
  const created: string[] = []
  const skipped: string[] = []

  for (const [name, seed] of Object.entries(EDITABLE_TEMPLATES)) {
    if (!seed) continue
    if (filter.length > 0 && !filter.includes(name)) {
      skipped.push(name)
      continue
    }
    const existing = await prisma.emailTemplate.findUnique({ where: { name } })
    if (existing) {
      await prisma.emailTemplate.update({
        where: { name },
        data: {
          subject: seed.subject,
          body: seed.body,
          propsExample: seed.propsExample as any,
        },
      })
      updated.push(name)
    } else {
      await prisma.emailTemplate.create({
        data: {
          name,
          subject: seed.subject,
          body: seed.body,
          propsExample: seed.propsExample as any,
        },
      })
      created.push(name)
    }
  }

  console.log(JSON.stringify({ updated, created, skipped, total: updated.length + created.length }, null, 2))
}

main()
  .catch((err) => {
    console.error('reseed_failed', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
