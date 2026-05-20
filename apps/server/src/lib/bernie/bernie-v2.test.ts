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

import { generateLyricsV2 } from './bernie-v2.js'
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

describe('generateLyricsV2 — hard ban block injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    draftFindFirst.mockResolvedValue({ version: 1, promptText: 'draft system prompt' })
    editFindFirst.mockResolvedValue({ version: 1, promptText: 'edit system prompt' })
  })

  it('injects DB ban words into BOTH draft and edit user messages', async () => {
    banFindMany.mockResolvedValue([
      { category: 'overused_word', text: 'coffee' },
    ])
    messagesCreate
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))
      .mockResolvedValueOnce(toolUseResponse('T', '[Chorus]\nhook here\n'))

    await generateLyricsV2({ hookText: 'hook here' })

    expect(messagesCreate).toHaveBeenCalledTimes(2)
    const draftUserMsg = messagesCreate.mock.calls[0][0].messages[0].content as string
    const editUserMsg = messagesCreate.mock.calls[1][0].messages[0].content as string
    expect(draftUserMsg).toContain('FORBIDDEN WORDS')
    expect(draftUserMsg).toContain('coffee')
    expect(editUserMsg).toContain('FORBIDDEN WORDS')
    expect(editUserMsg).toContain('coffee')
  })
})
