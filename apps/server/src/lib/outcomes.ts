// System-default outcome picker.
//
// Every Store needs a `defaultOutcomeId` — it's what plays when no schedule
// slot applies, and the Launch Checklist treats a missing default as a hard
// launch blocker. Daniel's rule (2026-05-11): the default should be set
// automatically at Store creation; making the operator pick one before
// launch is bureaucratic friction.
//
// Picking strategy: the alphabetically-first non-superseded Outcome.
// Deterministic, no schema change needed, and "Calm" happens to sort first
// in the current outcome set (which is also the most sensible safe default).
// If the system has no active outcomes, returns null and the caller leaves
// the field blank — the user can still pick manually later.
//
// Used by:
//   - lib/account.ts ensureFreeClientForUser
//   - routes/me.ts inline free-Store backstop
//   - routes/admin.ts admin Store create
//   - routes/billing.ts paid Store create (x2)
//
// Backfill of existing rows is handled by migration
// 20260511010000_default_outcome_for_existing_stores.

import { prisma } from '../db.js'

export async function pickSystemDefaultOutcomeId(): Promise<string | null> {
  const row = await prisma.outcome.findFirst({
    where: { supersededAt: null },
    orderBy: [{ title: 'asc' }, { version: 'desc' }],
    select: { id: true },
  })
  return row?.id ?? null
}
