// DB-backed loaders for the Flow engine. The Flow renderer (renderer.ts) and the
// timeline builder (timeline.ts) stay pure; this is where the DB reads happen.
// eno calls these and passes the loaded persona/config in.
//
// Mirrors lib/arranger/policy.ts (versioned-singleton config) and
// lib/music-professor/_helpers.ts (versioned persona + genre-gravity lookup).

import { Prisma } from '@prisma/client'
import { prisma } from '../../db.js'
import { FLOW_TIMELINE_POLICY_SEED, type FlowTimelineConfig } from './timeline.js'
import { FLOW_RENDERER_PERSONA_SEED } from './seeds.js'

export async function getOrSeedFlowRendererPersona(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.flowRendererPersona.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.flowRendererPersona.create({
    data: { version: 1, promptText: FLOW_RENDERER_PERSONA_SEED, notes: 'Auto-seeded v1' },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}

export interface LoadedFlowTimelinePolicy {
  version: number
  config: FlowTimelineConfig
}

export async function getOrSeedFlowTimelinePolicy(): Promise<LoadedFlowTimelinePolicy> {
  const row = await prisma.flowTimelinePolicy.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, config: row.config as unknown as FlowTimelineConfig }
  const seeded = await prisma.flowTimelinePolicy.create({
    data: {
      version: 1,
      config: FLOW_TIMELINE_POLICY_SEED as unknown as Prisma.InputJsonValue,
      notes: 'Auto-seeded v1 — default Flow timeline (≈180s target, chorus-weighted, gapped).',
    },
  })
  return { version: seeded.version, config: seeded.config as unknown as FlowTimelineConfig }
}

// The Music Professor's genre-gravity module reads GenreGravityRule.counterExclusions
// to carve a genre centroid. Flow skips the Music Professor, so it must pull the same
// knowledge directly. Matching mirrors Mars's harmonic-palette lookup: a rule applies
// when its tag is a substring of the anchor tag (case-insensitive). Returned terms feed
// the renderer's "avoid" context (which it rephrases positively).
export async function loadCounterExclusionsForAnchor(anchorTag: string | null): Promise<string[]> {
  if (!anchorTag || !anchorTag.trim()) return []
  const rules = await prisma.genreGravityRule.findMany({
    where: { active: true, counterExclusions: { isEmpty: false } },
    select: { tag: true, counterExclusions: true },
  })
  const anchorLower = anchorTag.toLowerCase()
  const matched = rules
    .filter((r) => anchorLower.includes(r.tag.toLowerCase()))
    .flatMap((r) => r.counterExclusions)
  return Array.from(new Set(matched))
}
