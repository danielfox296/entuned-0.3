import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    lyricDraftPrompt: { findFirst: vi.fn(), create: vi.fn() },
    lyricBanEntry: { findMany: vi.fn() },
    genreCraftRule: { count: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { generateLyrics, formatFormBrief, type GenreBrief, type OutcomeBrief } from './bernie.js'
import type { FormArchetypeChoice } from '../eno/form-archetype.js'
import { prisma } from '../../db.js'

const draftFindFirst = prisma.lyricDraftPrompt.findFirst as ReturnType<typeof vi.fn>
const banFindMany = prisma.lyricBanEntry.findMany as ReturnType<typeof vi.fn>
const genreCraftCount = prisma.genreCraftRule.count as ReturnType<typeof vi.fn>
const genreCraftFindMany = prisma.genreCraftRule.findMany as ReturnType<typeof vi.fn>

const HIP_HOP_RULE = {
  familyName: 'hip-hop',
  tags: ['hip-hop', 'hip hop', 'rap'],
  densityGuidance: 'Dense bars with internal rhymes.',
  rhymeGuidance: 'Multisyllabic rhymes, slant rhymes valid.',
  lineStructureGuidance: '8 or 16 bars per verse.',
  voiceGuidance: 'Declarative, narrative, observational.',
  typographyGuidance: 'Sparse parens for ad-libs.',
  isActive: true,
  sortOrder: 0,
}

function toolUseResponse(title: string, lyrics: string) {
  return {
    content: [
      { type: 'tool_use', name: 'emit_lyrics', input: { title, lyrics } },
    ],
  }
}

describe('generateLyrics — hard ban block injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    draftFindFirst.mockResolvedValue({ version: 1, promptText: 'draft system prompt' })
    genreCraftCount.mockResolvedValue(1)
    genreCraftFindMany.mockResolvedValue([HIP_HOP_RULE])
  })

  it('injects DB overused-word entries into the draft user message with FORBIDDEN framing', async () => {
    banFindMany.mockResolvedValue([
      { category: 'overused_word', text: 'coffee' },
    ])
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Verse 1]\nThe coffee is hot\n[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toContain('FORBIDDEN')
    expect(draftUserMsg).toContain('coffee')
  })

  it('injects DB cliche_phrase entries into the draft user message with FORBIDDEN framing', async () => {
    banFindMany.mockResolvedValue([
      { category: 'cliche_phrase', text: 'porch light' },
    ])
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toContain('FORBIDDEN')
    expect(draftUserMsg).toContain('Forbidden phrases')
    expect(draftUserMsg).toContain('porch light')
  })

  it('injects DB cliche_shape entries into the draft user message with FORBIDDEN framing', async () => {
    banFindMany.mockResolvedValue([
      { category: 'cliche_shape', text: '"My heart is [adjective]"' },
    ])
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toContain('FORBIDDEN')
    expect(draftUserMsg).toContain('Forbidden shapes')
    expect(draftUserMsg).toContain('[adjective]')
  })

  it('omits the ban block only when every category is empty', async () => {
    // Rows in an unknown category — none of the three known categories receive any entries,
    // proving the FORBIDDEN block is conditional on present ban data of *any* category.
    banFindMany.mockResolvedValue([
      { category: 'unknown_category', text: 'ignored' },
    ])
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).not.toContain('FORBIDDEN')
  })
})

describe('generateLyrics — genre brief injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    draftFindFirst.mockResolvedValue({ version: 1, promptText: 'draft system prompt' })
    genreCraftCount.mockResolvedValue(1)
    genreCraftFindMany.mockResolvedValue([HIP_HOP_RULE])
    banFindMany.mockResolvedValue([])
  })

  const brief: GenreBrief = {
    genreTag: 'hip-hop',
    grooveCharacter: 'syncopated, behind-the-beat',
    harmonicCharacter: 'minor pentatonic',
    vocalRegister: 'baritone',
    eraDecade: '2010s',
  }

  it('puts genre context into the draft user message', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', genreBrief: brief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toContain('Reference track context')
    expect(draftUserMsg).toContain('Genre: hip-hop')
    expect(draftUserMsg).toContain('Era: 2010s')
    expect(draftUserMsg).toContain('Groove: syncopated, behind-the-beat')
    expect(draftUserMsg).toContain('Vocal register: baritone')
  })

  it('injects genre-family craft guidance when the tag matches a known family', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', genreBrief: brief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toMatch(/hip-hop/i)
    expect(draftUserMsg).toMatch(/density|rhyme|bars/i)
  })

  it('falls back to no craft block for unknown genre tags but still injects context', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({
      hookText: 'hook here',
      genreBrief: { ...brief, genreTag: 'klezmer-djent-fusion' },
    })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toContain('Genre: klezmer-djent-fusion')
    expect(draftUserMsg).not.toMatch(/familyName/)
  })

  it('omits all genre signal when genreBrief is absent', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).not.toContain('Reference track context')
    expect(draftUserMsg).not.toContain('Genre:')
  })
})

describe('generateLyrics — outcome brief injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    draftFindFirst.mockResolvedValue({ version: 1, promptText: 'draft system prompt' })
    genreCraftCount.mockResolvedValue(1)
    genreCraftFindMany.mockResolvedValue([HIP_HOP_RULE])
    banFindMany.mockResolvedValue([])
  })

  const outcomeBrief: OutcomeBrief = {
    mood: 'calm browsing',
    tempoBpm: 75,
    mode: 'major',
  }

  it('puts the outcome brief in the draft user message', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', outcomeBrief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toContain('Emotional brief')
    expect(draftUserMsg).toContain('Mood: calm browsing')
    expect(draftUserMsg).toContain('Tempo: 75bpm')
    expect(draftUserMsg).toContain('Mode: major')
  })

  it('coexists with a genreBrief — both appear in the draft', async () => {
    const genreBrief: GenreBrief = {
      genreTag: 'hip-hop',
      grooveCharacter: 'syncopated',
      harmonicCharacter: 'minor pentatonic',
      vocalRegister: 'baritone',
      eraDecade: '2010s',
    }
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', genreBrief, outcomeBrief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).toContain('Genre: hip-hop')
    expect(draftUserMsg).toContain('Emotional brief')
    expect(draftUserMsg).toContain('Mood: calm browsing')
  })

  it('omits the brief when outcomeBrief is absent', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(draftUserMsg).not.toContain('Emotional brief')
  })
})

describe('generateLyrics — output shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    draftFindFirst.mockResolvedValue({ version: 7, promptText: 'draft system prompt' })
    genreCraftCount.mockResolvedValue(0)
    banFindMany.mockResolvedValue([])
  })

  it('returns title, lyrics, and draftPromptVersion only', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('My Title', '[Chorus]\nhook here\n'))

    const result = await generateLyrics({ hookText: 'hook here' })

    expect(result).toEqual({
      title: 'My Title',
      lyrics: '[Chorus]\nhook here\n',
      draftPromptVersion: 7,
    })
  })

  it('makes exactly one Anthropic call (single-pass)', async () => {
    messagesCreate.mockResolvedValue(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    expect(messagesCreate).toHaveBeenCalledTimes(1)
  })
})

describe('formatFormBrief — per-section arc rendering', () => {
  const form: FormArchetypeChoice = {
    id: 'x', slug: 'test', displayName: 'Test', shapeNote: 'note here',
    sections: [
      { label: 'Intro', optional: true, arc: 'The Frame — leave it to the music.' },
      { label: 'Verse 1', arc: 'Establish — one plain scene.' },
      { label: 'Chorus', arc: 'Thesis — say the one idea.' },
    ],
  }

  it('renders each section under its [Section] marker with its arc', () => {
    const brief = formatFormBrief(form)
    expect(brief).toContain('[Verse 1] — Establish — one plain scene.')
    expect(brief).toContain('[Chorus] — Thesis — say the one idea.')
  })

  it('marks optional sections', () => {
    const brief = formatFormBrief(form)
    expect(brief).toContain('[Intro] (optional')
  })

  it('preserves section order', () => {
    const brief = formatFormBrief(form)
    expect(brief.indexOf('[Verse 1]')).toBeLessThan(brief.indexOf('[Chorus]'))
    expect(brief.indexOf('[Intro]')).toBeLessThan(brief.indexOf('[Verse 1]'))
  })

  it('carries the shape note', () => {
    expect(formatFormBrief(form)).toContain('note here')
  })
})
