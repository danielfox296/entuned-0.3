import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma before importing the module under test.
vi.mock('../../db.js', () => ({
  prisma: {
    formArchetype: { findMany: vi.fn() },
  },
}))

import { pickFormArchetype } from './form-archetype.js'
import { prisma } from '../../db.js'

const findMany = prisma.formArchetype.findMany as unknown as ReturnType<typeof vi.fn>

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'id-1',
    slug: 'vcvc',
    displayName: 'VCVC',
    sections: [{ label: 'Verse 1', arc: 'Cold Open — one image.' }, { label: 'Chorus', arc: 'Thesis — say it.' }],
    shapeNote: 'note',
    requiresSections: [] as string[],
    outcomeWeights: { '*': 1 },
    eraWeights: null,
    isActive: true,
    ...over,
  }
}

const input = { outcomeKey: 'k', arrangementSections: null, referenceYear: null }

beforeEach(() => { findMany.mockReset() })

describe('pickFormArchetype', () => {
  it('returns the legacy default (id null, non-empty sections) when the DB is empty', async () => {
    findMany.mockResolvedValue([])
    const choice = await pickFormArchetype(input)
    expect(choice.id).toBeNull()
    expect(choice.slug).toBe('vcvcbc')
    expect(choice.sections.length).toBeGreaterThan(0)
  })

  it('passes through the chosen archetype’s structured sections', async () => {
    findMany.mockResolvedValue([row()])
    const choice = await pickFormArchetype(input)
    expect(choice.id).toBe('id-1')
    expect(choice.sections).toEqual([
      { label: 'Verse 1', arc: 'Cold Open — one image.' },
      { label: 'Chorus', arc: 'Thesis — say it.' },
    ])
  })

  it('skips archetypes whose sections array is empty (migrate→seed safety net)', async () => {
    findMany.mockResolvedValue([row({ sections: [] })])
    const choice = await pickFormArchetype(input)
    expect(choice.id).toBeNull() // fell back to legacy default
  })

  it('skips archetypes with a non-array sections value', async () => {
    findMany.mockResolvedValue([row({ sections: null })])
    const choice = await pickFormArchetype(input)
    expect(choice.id).toBeNull()
  })

  it('respects requiresSections gating against the reference track', async () => {
    findMany.mockResolvedValue([row({ requiresSections: ['bridge'] })])
    // arrangementSections present but lacks "bridge" → archetype ineligible → legacy
    const choice = await pickFormArchetype({ ...input, arrangementSections: { verse: {}, chorus: {} } as never })
    expect(choice.id).toBeNull()
  })

  it('skips zero-weighted archetypes for the given outcome', async () => {
    findMany.mockResolvedValue([row({ outcomeWeights: { '*': 0 } })])
    const choice = await pickFormArchetype(input)
    expect(choice.id).toBeNull()
  })
})
