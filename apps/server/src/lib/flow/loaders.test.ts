import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    flowRendererPersona: { findFirst: vi.fn(), create: vi.fn() },
    flowTimelinePolicy: { findFirst: vi.fn(), create: vi.fn() },
    genreGravityRule: { findMany: vi.fn() },
  },
}))

import { getOrSeedFlowRendererPersona, getOrSeedFlowTimelinePolicy, loadCounterExclusionsForAnchor } from './loaders.js'
import { FLOW_TIMELINE_POLICY_SEED } from './timeline.js'
import { FLOW_RENDERER_PERSONA_SEED } from './seeds.js'
import { prisma } from '../../db.js'

const personaFindFirst = prisma.flowRendererPersona.findFirst as ReturnType<typeof vi.fn>
const personaCreate = prisma.flowRendererPersona.create as ReturnType<typeof vi.fn>
const policyFindFirst = prisma.flowTimelinePolicy.findFirst as ReturnType<typeof vi.fn>
const policyCreate = prisma.flowTimelinePolicy.create as ReturnType<typeof vi.fn>
const gravityFindMany = prisma.genreGravityRule.findMany as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('getOrSeedFlowRendererPersona', () => {
  it('returns the latest row when present', async () => {
    personaFindFirst.mockResolvedValue({ version: 4, promptText: 'live persona' })
    const out = await getOrSeedFlowRendererPersona()
    expect(out).toEqual({ version: 4, promptText: 'live persona' })
    expect(personaCreate).not.toHaveBeenCalled()
  })

  it('cold-seeds v1 from the constant when the table is empty', async () => {
    personaFindFirst.mockResolvedValue(null)
    personaCreate.mockResolvedValue({ version: 1, promptText: FLOW_RENDERER_PERSONA_SEED })
    const out = await getOrSeedFlowRendererPersona()
    expect(personaCreate).toHaveBeenCalledOnce()
    expect(out.version).toBe(1)
  })
})

describe('getOrSeedFlowTimelinePolicy', () => {
  it('returns the latest config when present', async () => {
    policyFindFirst.mockResolvedValue({ version: 2, config: { targetDurationSec: 200 } })
    const out = await getOrSeedFlowTimelinePolicy()
    expect(out.version).toBe(2)
    expect(out.config.targetDurationSec).toBe(200)
  })

  it('cold-seeds v1 from FLOW_TIMELINE_POLICY_SEED when empty', async () => {
    policyFindFirst.mockResolvedValue(null)
    policyCreate.mockResolvedValue({ version: 1, config: FLOW_TIMELINE_POLICY_SEED })
    const out = await getOrSeedFlowTimelinePolicy()
    expect(policyCreate).toHaveBeenCalledOnce()
    expect(out.config.targetDurationSec).toBe(FLOW_TIMELINE_POLICY_SEED.targetDurationSec)
  })
})

describe('loadCounterExclusionsForAnchor', () => {
  it('matches rules whose tag is a substring of the anchor and dedupes', async () => {
    gravityFindMany.mockResolvedValue([
      { tag: 'soul', counterExclusions: ['smooth jazz', 'adult contemporary'] },
      { tag: '1970s soul', counterExclusions: ['adult contemporary', 'disco strings'] },
      { tag: 'metal', counterExclusions: ['double kick'] },
    ])
    const out = await loadCounterExclusionsForAnchor('1970s soul')
    expect(out).toEqual(expect.arrayContaining(['smooth jazz', 'adult contemporary', 'disco strings']))
    expect(out).not.toContain('double kick')
    // dedup: 'adult contemporary' appears once
    expect(out.filter((t) => t === 'adult contemporary')).toHaveLength(1)
  })

  it('returns [] for a null/empty anchor without hitting the DB', async () => {
    expect(await loadCounterExclusionsForAnchor(null)).toEqual([])
    expect(await loadCounterExclusionsForAnchor('  ')).toEqual([])
    expect(gravityFindMany).not.toHaveBeenCalled()
  })
})
