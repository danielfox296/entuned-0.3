import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    musicProfessorPersona: { findFirst: vi.fn(), create: vi.fn() },
    musicProfessorModule: { findMany: vi.fn(), count: vi.fn(), createMany: vi.fn() },
    genreGravityRule: { findMany: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { runMusicProfessor } from './music-professor.js'
import { prisma } from '../../db.js'

const personaFindFirst = prisma.musicProfessorPersona.findFirst as ReturnType<typeof vi.fn>
const moduleFindMany = prisma.musicProfessorModule.findMany as ReturnType<typeof vi.fn>
const moduleCount = prisma.musicProfessorModule.count as ReturnType<typeof vi.fn>
const gravityFindMany = prisma.genreGravityRule.findMany as ReturnType<typeof vi.fn>

function toolUseResponse(style: string, negativeStyle: string, changeLog: string[] = []) {
  return {
    content: [
      { type: 'tool_use', name: 'emit_polished_style', input: { style, negativeStyle, changeLog } },
    ],
  }
}

const SAMPLE_INPUT = {
  style: 'folk rock, acoustic guitar, warm tape, late-70s, mellow, intimate, warm',
  negativeStyle: 'edm, dubstep, heavy metal',
  anchorTag: 'folk rock',
}

const POLISHED_OK = 'folk rock, acoustic guitar, late-70s warm tape, mellow'
const POLISHED_NEG_OK = 'edm, dubstep, heavy metal, sidechain, autotune, trap hi-hats, brick-wall limiting'

const SAMPLE_MODULES = [
  { id: '1', name: 'Era-conditional modern-exclusion', body: 'principle text', sortOrder: 10, tier: 'core' },
  { id: '2', name: 'Token economy and reorder', body: 'principle text', sortOrder: 30, tier: 'core' },
]

const SAMPLE_GRAVITY = [
  { tag: 'soft rock', counterExclusions: ['smooth jazz', 'adult contemporary'] },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  personaFindFirst.mockResolvedValue({ version: 1, promptText: 'music professor system prompt' })
  moduleFindMany.mockResolvedValue(SAMPLE_MODULES)
  moduleCount.mockResolvedValue(SAMPLE_MODULES.length)
  gravityFindMany.mockResolvedValue(SAMPLE_GRAVITY)
})

describe('runMusicProfessor — happy path', () => {
  it('returns polished style + negativeStyle and threads persona version through', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, POLISHED_NEG_OK, ['Era exclusion', 'Token economy']))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.style).toBe(POLISHED_OK)
    expect(out.negativeStyle).toBe(POLISHED_NEG_OK)
    expect(out.personaVersion).toBe(1)
    expect(out.changeLog).toEqual(['Era exclusion', 'Token economy'])
    expect(out.fellBack).toBe(false)
  })

  it('injects curriculum + genre gravity rules into the system prompt', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, POLISHED_NEG_OK))

    await runMusicProfessor(SAMPLE_INPUT)

    const call = messagesCreate.mock.calls[0][0]
    const systemBlock = call.system[0].text as string
    expect(systemBlock).toContain('music professor system prompt')
    expect(systemBlock).toContain('Era-conditional modern-exclusion')
    expect(systemBlock).toContain('Token economy and reorder')
    expect(systemBlock).toContain('Curriculum modules')
    expect(systemBlock).toContain('Genre gravity rules')
    expect(systemBlock).toContain('"soft rock"')
    expect(systemBlock).toContain('smooth jazz')
  })

  it('runs with empty gravity block when GenreGravityRule table is empty', async () => {
    gravityFindMany.mockResolvedValueOnce([])
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, POLISHED_NEG_OK))

    await runMusicProfessor(SAMPLE_INPUT)

    const systemBlock = messagesCreate.mock.calls[0][0].system[0].text as string
    expect(systemBlock).not.toContain('Genre gravity rules')
  })

  it('runs persona-only when no modules are active', async () => {
    moduleFindMany.mockResolvedValueOnce([])
    moduleCount.mockResolvedValueOnce(5) // table has rows, just none active
    moduleFindMany.mockResolvedValue([])
    gravityFindMany.mockResolvedValueOnce([])
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(false)
    const systemBlock = messagesCreate.mock.calls[0][0].system[0].text as string
    expect(systemBlock).not.toContain('Curriculum modules')
  })

  it('skips the anchor-preservation check when no anchor tag is provided', async () => {
    // legacy / router builders pass anchorTag: null. The check should not fire.
    messagesCreate.mockResolvedValue(toolUseResponse('a completely different style list', POLISHED_NEG_OK))

    const out = await runMusicProfessor({ style: SAMPLE_INPUT.style, negativeStyle: SAMPLE_INPUT.negativeStyle, anchorTag: null })

    expect(out.fellBack).toBe(false)
    expect(out.style).toBe('a completely different style list')
  })
})

describe('runMusicProfessor — safety fallbacks', () => {
  it('falls back when the model strips the genre anchor', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('acoustic guitar, mellow, intimate', POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.style).toBe(SAMPLE_INPUT.style)
    expect(out.negativeStyle).toBe(SAMPLE_INPUT.negativeStyle)
    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('anchor_dropped')
    expect(out.changeLog).toEqual([])
  })

  it('falls back when the polished style overflows the cap', async () => {
    const longStyle = 'folk rock, ' + 'extra tag, '.repeat(50)
    messagesCreate.mockResolvedValue(toolUseResponse(longStyle, POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('style_overflow')
  })

  it('falls back when the polished negative style overflows the cap', async () => {
    const longNeg = 'edm, ' + 'banned tag, '.repeat(120)
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, longNeg))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('negative_style_overflow')
  })

  it('falls back when banned token (vocal) appears in positive style', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('folk rock, acoustic guitar, male vocal', POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('banned_token_present')
  })

  it('falls back when banned token (chorus) appears in positive style', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('folk rock, acoustic guitar, chorus hooks', POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('banned_token_present')
  })

  it('does NOT fall back when banned tokens appear in NEGATIVE style', async () => {
    // "no chorus pad" / "no autotuned vocal" are legitimate negative-style entries
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, 'edm, chorus pad, autotuned vocal'))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(false)
  })

  it('falls back when the API call throws', async () => {
    messagesCreate.mockRejectedValue(new Error('network down'))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.style).toBe(SAMPLE_INPUT.style)
    expect(out.negativeStyle).toBe(SAMPLE_INPUT.negativeStyle)
    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('tool_refusal')
  })

  it('falls back when the model returns empty style', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('   ', POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('empty_style')
  })

  it('clamps changeLog to 6 entries and drops empty/non-string entries', async () => {
    const bloated = ['a', 'b', '', 'c', null as any, 'd', 'e', 'f', 'g', 'h']
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, POLISHED_NEG_OK, bloated))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.changeLog.length).toBeLessThanOrEqual(6)
    expect(out.changeLog).not.toContain('')
    expect(out.changeLog.every((t) => typeof t === 'string')).toBe(true)
  })

  it('matches anchor case-insensitively', async () => {
    // Anchor is "folk rock", polished output has "Folk Rock" — should pass
    messagesCreate.mockResolvedValue(toolUseResponse('Folk Rock, acoustic guitar', POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(out.fellBack).toBe(false)
  })
})

describe('runMusicProfessor — cold start', () => {
  it('seeds the persona when the table is empty', async () => {
    personaFindFirst.mockResolvedValueOnce(null)
    const personaCreate = prisma.musicProfessorPersona.create as ReturnType<typeof vi.fn>
    personaCreate.mockResolvedValue({ version: 1, promptText: 'seeded persona' })
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, POLISHED_NEG_OK))

    const out = await runMusicProfessor(SAMPLE_INPUT)

    expect(personaCreate).toHaveBeenCalledOnce()
    expect(out.personaVersion).toBe(1)
  })

  it('seeds the modules when the table is empty', async () => {
    moduleFindMany.mockResolvedValueOnce([])
    moduleCount.mockResolvedValueOnce(0)
    const moduleCreateMany = prisma.musicProfessorModule.createMany as ReturnType<typeof vi.fn>
    moduleCreateMany.mockResolvedValue({ count: 5 })
    moduleFindMany.mockResolvedValueOnce(SAMPLE_MODULES)
    messagesCreate.mockResolvedValue(toolUseResponse(POLISHED_OK, POLISHED_NEG_OK))

    await runMusicProfessor(SAMPLE_INPUT)

    expect(moduleCreateMany).toHaveBeenCalledOnce()
    const call = moduleCreateMany.mock.calls[0][0]
    expect(call.data.length).toBe(5)
    expect(call.data[0].name).toBe('Era-conditional modern-exclusion')
    expect(call.data[0].tier).toBe('core')
  })
})
