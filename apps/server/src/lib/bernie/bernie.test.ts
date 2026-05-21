import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    lyricDraftPrompt: { findFirst: vi.fn(), create: vi.fn() },
    lyricEditPrompt: { findFirst: vi.fn(), create: vi.fn() },
    lyricBanEntry: { findMany: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { generateLyrics, type GenreBrief, type OutcomeBrief } from './bernie.js'
import { prisma } from '../../db.js'

const draftFindFirst = prisma.lyricDraftPrompt.findFirst as ReturnType<typeof vi.fn>
const editFindFirst = prisma.lyricEditPrompt.findFirst as ReturnType<typeof vi.fn>
const banFindMany = prisma.lyricBanEntry.findMany as ReturnType<typeof vi.fn>

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
    editFindFirst.mockResolvedValue({ version: 1, promptText: 'edit system prompt' })
  })

  it('injects DB ban words into BOTH draft and edit user messages with FORBIDDEN framing', async () => {
    banFindMany.mockResolvedValue([
      { category: 'overused_word', text: 'coffee' },
    ])
    // Draft pass returns lyrics that still include the banned word (simulating the leak)
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Verse 1]\nThe coffee is hot\n[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Verse 1]\nThe morning is hot\n[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    expect(messagesCreate).toHaveBeenCalledTimes(2)
    const draftCall = messagesCreate.mock.calls[0][0]
    const editCall = messagesCreate.mock.calls[1][0]
    const draftUserMsg = draftCall.messages[0].content as string
    const editUserMsg = editCall.messages[0].content as string

    expect(draftUserMsg).toContain('FORBIDDEN WORDS')
    expect(draftUserMsg).toContain('coffee')
    expect(editUserMsg).toContain('FORBIDDEN WORDS')
    expect(editUserMsg).toContain('coffee')
  })

  it('omits the ban block entirely when DB has no overused-word entries', async () => {
    banFindMany.mockResolvedValue([])
    // Also stub OVERUSED_WORDS fallback: loadBanEntries returns hardcoded list when DB
    // is empty, so the block will still render. To prove omission, return a non-empty
    // categories-other-than-overused result so loadBanEntries doesn't fall back.
    banFindMany.mockResolvedValue([
      { category: 'cliche_phrase', text: 'You complete me' },
    ])
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    const editUserMsg = messagesCreate.mock.calls[1][0].messages[0].content as string
    expect(draftUserMsg).not.toContain('FORBIDDEN WORDS')
    expect(editUserMsg).not.toContain('FORBIDDEN WORDS')
  })
})

describe('generateLyrics — genre brief injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    draftFindFirst.mockResolvedValue({ version: 1, promptText: 'draft system prompt' })
    editFindFirst.mockResolvedValue({ version: 1, promptText: 'edit system prompt' })
    banFindMany.mockResolvedValue([])
  })

  const brief: GenreBrief = {
    genreTag: 'hip-hop',
    grooveCharacter: 'syncopated, behind-the-beat',
    harmonicCharacter: 'minor pentatonic',
    vocalRegister: 'baritone',
    eraDecade: '2010s',
  }

  it('puts genre context + craft block in the DRAFT pass and keeps them OUT of the edit pass', async () => {
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', genreBrief: brief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    const editUserMsg = messagesCreate.mock.calls[1][0].messages[0].content as string

    // Draft sees the brief fields
    expect(draftUserMsg).toContain('Reference track context')
    expect(draftUserMsg).toContain('Genre: hip-hop')
    expect(draftUserMsg).toContain('Era: 2010s')
    expect(draftUserMsg).toContain('Groove: syncopated, behind-the-beat')
    expect(draftUserMsg).toContain('Vocal register: baritone')

    // Edit pass is polish-only — must NOT see the brief
    expect(editUserMsg).not.toContain('Reference track context')
    expect(editUserMsg).not.toContain('Genre: hip-hop')
    expect(editUserMsg).not.toContain('Era: 2010s')
  })

  it('injects genre-family craft guidance into the draft when the tag matches a known family', async () => {
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', genreBrief: brief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string

    // genre-craft-rules.ts maps 'hip-hop' → familyName 'hip-hop' with density/rhyme guidance
    expect(draftUserMsg).toMatch(/hip-hop/i)
    // The craft block is structured guidance — should mention bars/density/rhyme
    expect(draftUserMsg).toMatch(/density|rhyme|bars/i)
  })

  it('falls back to no craft block for unknown genre tags but still injects context', async () => {
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({
      hookText: 'hook here',
      genreBrief: { ...brief, genreTag: 'klezmer-djent-fusion' },
    })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string

    // Context block still appears with the unknown tag
    expect(draftUserMsg).toContain('Genre: klezmer-djent-fusion')
    // No genre-family override matches — formatGenreCraftBlock isn't called
    expect(draftUserMsg).not.toMatch(/familyName/)
  })

  it('omits all genre signal from BOTH passes when genreBrief is absent', async () => {
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    const editUserMsg = messagesCreate.mock.calls[1][0].messages[0].content as string

    expect(draftUserMsg).not.toContain('Reference track context')
    expect(draftUserMsg).not.toContain('Genre:')
    expect(editUserMsg).not.toContain('Reference track context')
    expect(editUserMsg).not.toContain('Genre:')
  })
})

describe('generateLyrics — outcome brief injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    draftFindFirst.mockResolvedValue({ version: 1, promptText: 'draft system prompt' })
    editFindFirst.mockResolvedValue({ version: 1, promptText: 'edit system prompt' })
    banFindMany.mockResolvedValue([])
  })

  const outcomeBrief: OutcomeBrief = {
    mood: 'calm browsing',
    tempoBpm: 75,
    mode: 'major',
  }

  it('puts the outcome brief in the DRAFT pass and keeps it OUT of the edit pass', async () => {
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', outcomeBrief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    const editUserMsg = messagesCreate.mock.calls[1][0].messages[0].content as string

    expect(draftUserMsg).toContain('Emotional brief')
    expect(draftUserMsg).toContain('Mood: calm browsing')
    expect(draftUserMsg).toContain('Tempo: 75bpm')
    expect(draftUserMsg).toContain('Mode: major')

    expect(editUserMsg).not.toContain('Emotional brief')
    expect(editUserMsg).not.toContain('Mood:')
    expect(editUserMsg).not.toContain('Tempo:')
  })

  it('coexists with a genreBrief — both appear in the draft, neither in the edit', async () => {
    const genreBrief: GenreBrief = {
      genreTag: 'hip-hop',
      grooveCharacter: 'syncopated',
      harmonicCharacter: 'minor pentatonic',
      vocalRegister: 'baritone',
      eraDecade: '2010s',
    }
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here', genreBrief, outcomeBrief })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    const editUserMsg = messagesCreate.mock.calls[1][0].messages[0].content as string

    expect(draftUserMsg).toContain('Genre: hip-hop')
    expect(draftUserMsg).toContain('Emotional brief')
    expect(draftUserMsg).toContain('Mood: calm browsing')

    expect(editUserMsg).not.toContain('Genre:')
    expect(editUserMsg).not.toContain('Emotional brief')
  })

  it('omits the brief from both passes when outcomeBrief is absent', async () => {
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyrics({ hookText: 'hook here' })

    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    const editUserMsg = messagesCreate.mock.calls[1][0].messages[0].content as string

    expect(draftUserMsg).not.toContain('Emotional brief')
    expect(editUserMsg).not.toContain('Emotional brief')
  })
})
