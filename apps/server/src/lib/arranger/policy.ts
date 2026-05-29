// Loader for the operator-tunable Stager (arranger) policy. Versioned singleton:
// latest version wins at runtime. Seeds v1 from ARRANGEMENT_POLICY_SEED (the
// formerly-hardcoded behavior) on first read, so behavior is unchanged until an
// operator edits it in Dash → Engine → Arrangement Rules.
//
// arranger.ts stays pure (no DB); this is where the DB read happens. eno calls
// getOrSeedArrangementPolicy() and passes the config into injectArrangement().

import { Prisma } from '@prisma/client'
import { prisma } from '../../db.js'
import { ARRANGEMENT_POLICY_SEED, type ArrangementConfig } from './arranger.js'

export interface LoadedArrangementPolicy {
  version: number
  config: ArrangementConfig
}

export async function getOrSeedArrangementPolicy(): Promise<LoadedArrangementPolicy> {
  const row = await prisma.arrangementPolicy.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, config: row.config as unknown as ArrangementConfig }
  const seeded = await prisma.arrangementPolicy.create({
    data: {
      version: 1,
      config: ARRANGEMENT_POLICY_SEED as unknown as Prisma.InputJsonValue,
      notes: 'Auto-seeded v1 — reproduces the formerly-hardcoded arranger behavior + outro carry-out.',
    },
  })
  return { version: seeded.version, config: seeded.config as unknown as ArrangementConfig }
}
