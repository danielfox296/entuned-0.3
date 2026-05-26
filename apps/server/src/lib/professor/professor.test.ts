import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    professorPersona: { findFirst: vi.fn(), create: vi.fn() },
    professorModule: { findMany: vi.fn(), count: vi.fn(), createMany: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { runProfessor } from './professor.js'
import { prisma } from '../../db.js'

const personaFindFirst = prisma.professorPersona.findFirst as ReturnType<typeof vi.fn>
const moduleFindMany = prisma.professorModule.findMany as ReturnType<typeof vi.fn>
const moduleCount = prisma.professorModule.count as ReturnType<typeof vi.fn>

function toolUseResponse(lyrics: string, changeLog: string[] = []) {
  return {
    content: [
      { type: 'tool_use', name: 'emit_finished_lyric', input: { lyrics, changeLog } },
    ],
  }
}

const SAMPLE_DRAFT = `[Verse 1]
the room was empty and i felt alone
the silence spoke louder than words
[Chorus]
hold on to me
hold on to me
[Verse 2]
the streets were quiet as i walked home
the memories danced around my head
[Chorus]
hold on to me
hold on to me`

const FINISHED_OK = `[Verse 1]
the kitchen light burned at midnight, your jacket on the chair
i counted the cracks in the ceiling tile
[Chorus]
hold on to me
hold on to me
[Verse 2]
i walked the block twice and the porch lamp was off
i kept replaying what you said in the hall
[Chorus]
hold on to me
hold on to me`

const SAMPLE_MODULES = [
  { id: '1', name: 'Concrete embodiment', body: 'principle text', sortOrder: 10 },
  { id: '2', name: 'Inanimate agency', body: 'principle text', sortOrder: 20 },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  personaFindFirst.mockResolvedValue({ version: 1, promptText: 'professor system prompt' })
  moduleFindMany.mockResolvedValue(SAMPLE_MODULES)
  moduleCount.mockResolvedValue(SAMPLE_MODULES.length)
})

describe('runProfessor — happy path', () => {
  it('returns the finished lyric and threads persona version through', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse(FINISHED_OK, ['Concrete embodiment', 'Inanimate agency']))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(out.lyrics).toBe(FINISHED_OK)
    expect(out.personaVersion).toBe(1)
    expect(out.changeLog).toEqual(['Concrete embodiment', 'Inanimate agency'])
    expect(out.fellBack).toBe(false)
  })

  it('injects the curriculum block into the system prompt', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse(FINISHED_OK))

    await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    const call = messagesCreate.mock.calls[0][0]
    const systemBlock = call.system[0].text as string
    expect(systemBlock).toContain('professor system prompt')
    expect(systemBlock).toContain('Concrete embodiment')
    expect(systemBlock).toContain('Inanimate agency')
    expect(systemBlock).toContain('Curriculum modules')
  })

  it('runs persona-only when no modules are active', async () => {
    moduleFindMany.mockResolvedValueOnce([])
    moduleCount.mockResolvedValueOnce(5) // table has rows, just none active
    moduleFindMany.mockResolvedValue([])
    messagesCreate.mockResolvedValue(toolUseResponse(FINISHED_OK))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(out.fellBack).toBe(false)
    const systemBlock = messagesCreate.mock.calls[0][0].system[0].text as string
    expect(systemBlock).not.toContain('Curriculum modules')
  })
})

describe('runProfessor — safety fallbacks', () => {
  it('falls back when the model drops the hook', async () => {
    const noHook = `[Verse 1]
something new here
[Chorus]
something different`
    messagesCreate.mockResolvedValue(toolUseResponse(noHook, ['Concrete embodiment']))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(out.lyrics).toBe(SAMPLE_DRAFT)
    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('hook_dropped')
    expect(out.changeLog).toEqual([])
  })

  it('falls back when section marker count changes', async () => {
    // Hook preserved, but one of the four section markers (the second [Chorus]) is dropped.
    // The hook-preservation check passes; the section-marker check is what should fire.
    const missingChorusMarker = `[Verse 1]
something new here
hold on to me
hold on to me
[Verse 2]
something else
[Chorus]
hold on to me
hold on to me`
    messagesCreate.mockResolvedValue(toolUseResponse(missingChorusMarker))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(out.lyrics).toBe(SAMPLE_DRAFT)
    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('section_markers_lost')
  })

  it('falls back when the API call throws', async () => {
    messagesCreate.mockRejectedValue(new Error('network down'))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(out.lyrics).toBe(SAMPLE_DRAFT)
    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('tool_refusal')
  })

  it('falls back when the model returns empty lyrics', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('   '))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(out.lyrics).toBe(SAMPLE_DRAFT)
    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('empty_lyrics')
  })

  it('clamps changeLog to 8 entries and drops empty/non-string entries', async () => {
    const bloatedLog = ['a', 'b', '', 'c', null as any, 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    messagesCreate.mockResolvedValue(toolUseResponse(FINISHED_OK, bloatedLog))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(out.changeLog.length).toBeLessThanOrEqual(8)
    expect(out.changeLog).not.toContain('')
    expect(out.changeLog.every((t) => typeof t === 'string')).toBe(true)
  })
})

describe('runProfessor — cold start', () => {
  it('seeds the persona when the table is empty', async () => {
    personaFindFirst.mockResolvedValueOnce(null)
    const personaCreate = prisma.professorPersona.create as ReturnType<typeof vi.fn>
    personaCreate.mockResolvedValue({ version: 1, promptText: 'seeded persona' })
    messagesCreate.mockResolvedValue(toolUseResponse(FINISHED_OK))

    const out = await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(personaCreate).toHaveBeenCalledOnce()
    expect(out.personaVersion).toBe(1)
  })

  it('seeds the modules when the table is empty', async () => {
    moduleFindMany.mockResolvedValueOnce([])
    moduleCount.mockResolvedValueOnce(0)
    const moduleCreateMany = prisma.professorModule.createMany as ReturnType<typeof vi.fn>
    moduleCreateMany.mockResolvedValue({ count: 9 })
    moduleFindMany.mockResolvedValueOnce(SAMPLE_MODULES)
    messagesCreate.mockResolvedValue(toolUseResponse(FINISHED_OK))

    await runProfessor({ draftLyrics: SAMPLE_DRAFT, hookText: 'hold on to me' })

    expect(moduleCreateMany).toHaveBeenCalledOnce()
    const call = moduleCreateMany.mock.calls[0][0]
    expect(call.data.length).toBe(11)
    expect(call.data[0].name).toBe('Concrete embodiment')
  })
})
