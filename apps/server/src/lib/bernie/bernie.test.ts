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

import { generateLyrics } from './bernie.js'
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
