import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    hookEditorPrompt: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import {
  editHooks,
  buildEditorUserMessage,
  getOrSeedHookEditorPrompt,
  HOOK_EDITOR_PROMPT_SEED,
} from './editor.js'
import { _resetAnthropicForTests } from '../_llm/client.js'
import { prisma } from '../../db.js'
import type { DraftedHook } from './drafter.js'

const promptFind = prisma.hookEditorPrompt.findFirst as ReturnType<typeof vi.fn>
const promptCreate = prisma.hookEditorPrompt.create as ReturnType<typeof vi.fn>

function toolResponse(hooks: unknown) {
  return { content: [{ type: 'tool_use', name: 'emit_edited_hooks', input: { hooks } }] }
}

const IN: DraftedHook[] = [
  { text: 'The kettle ticks and nobody moves', vocalGender: null },
  { text: 'I fold the map the way my father did', vocalGender: 'female' },
]

beforeEach(() => {
  vi.clearAllMocks()
  _resetAnthropicForTests()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  promptFind.mockResolvedValue({ version: 3, promptText: 'EDITOR PROMPT' })
})

describe('getOrSeedHookEditorPrompt', () => {
  it('returns the latest row when one exists and does not seed', async () => {
    const r = await getOrSeedHookEditorPrompt()
    expect(r).toEqual({ version: 3, promptText: 'EDITOR PROMPT' })
    expect(promptCreate).not.toHaveBeenCalled()
  })

  it('cold-starts v1 from the TS const when the table is empty', async () => {
    promptFind.mockResolvedValue(null)
    promptCreate.mockResolvedValue({ version: 1, promptText: HOOK_EDITOR_PROMPT_SEED })
    const r = await getOrSeedHookEditorPrompt()
    expect(r.version).toBe(1)
    expect(promptCreate).toHaveBeenCalledOnce()
    expect(promptCreate.mock.calls[0]![0].data.promptText).toBe(HOOK_EDITOR_PROMPT_SEED)
  })
})

describe('buildEditorUserMessage', () => {
  it('numbers the hooks in order and states the expected count', () => {
    const msg = buildEditorUserMessage(IN)
    expect(msg).toContain('1. The kettle ticks and nobody moves')
    expect(msg).toContain('2. I fold the map the way my father did')
    expect(msg).toContain('Return exactly 2 entries')
  })
})

describe('editHooks', () => {
  it('applies rewrites and leaves compliant hooks byte-identical', async () => {
    messagesCreate.mockResolvedValue(
      toolResponse([
        { text: 'I wait out the kettle', changed: true, reason: 'thing-subject main clause' },
        { text: 'I fold the map the way my father did', changed: false },
      ])
    )
    const r = await editHooks(IN)
    expect(r.fellBack).toBe(false)
    expect(r.editorVersion).toBe(3)
    expect(r.changedCount).toBe(1)
    expect(r.hooks.map((h) => h.text)).toEqual([
      'I wait out the kettle',
      'I fold the map the way my father did',
    ])
    expect(r.notes[0]).toContain('thing-subject main clause')
  })

  it('carries vocalGender across by index — it is the drafter\'s call, not the editor\'s', async () => {
    messagesCreate.mockResolvedValue(
      toolResponse([
        { text: 'I wait out the kettle', changed: true },
        { text: 'A totally different line', changed: true },
      ])
    )
    const r = await editHooks(IN)
    expect(r.hooks[0]!.vocalGender).toBeNull()
    expect(r.hooks[1]!.vocalGender).toBe('female')
  })

  it('drops hooks the editor marks keep=false', async () => {
    messagesCreate.mockResolvedValue(
      toolResponse([
        { text: 'The kettle ticks and nobody moves', changed: false, keep: false, reason: 'unfixable' },
        { text: 'I fold the map the way my father did', changed: false },
      ])
    )
    const r = await editHooks(IN)
    expect(r.droppedCount).toBe(1)
    expect(r.hooks).toHaveLength(1)
    expect(r.hooks[0]!.text).toBe('I fold the map the way my father did')
    expect(r.notes[0]).toContain('dropped')
  })

  it('keeps the original when the editor returns an empty string for a slot', async () => {
    messagesCreate.mockResolvedValue(
      toolResponse([
        { text: '   ', changed: true },
        { text: 'I fold the map the way my father did', changed: false },
      ])
    )
    const r = await editHooks(IN)
    expect(r.hooks).toHaveLength(2)
    expect(r.hooks[0]!.text).toBe('The kettle ticks and nobody moves')
  })

  // --- Safety: the editor must never cost a draft run ---

  it('falls back unchanged on a count mismatch (editor lost its place)', async () => {
    messagesCreate.mockResolvedValue(toolResponse([{ text: 'only one', changed: true }]))
    const r = await editHooks(IN)
    expect(r.fellBack).toBe(true)
    expect(r.fallbackReason).toBe('count_mismatch')
    expect(r.hooks).toEqual(IN)
  })

  it('falls back unchanged when the model does not emit the tool', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry' }] })
    const r = await editHooks(IN)
    expect(r.fellBack).toBe(true)
    expect(r.fallbackReason).toBe('tool_refusal')
    expect(r.hooks).toEqual(IN)
  })

  it('falls back unchanged on an API error rather than throwing', async () => {
    messagesCreate.mockRejectedValue(new Error('overloaded'))
    await expect(editHooks(IN)).resolves.toMatchObject({
      fellBack: true,
      fallbackReason: 'api_error',
      hooks: IN,
    })
  })

  it('short-circuits on an empty batch without calling the model', async () => {
    const r = await editHooks([])
    expect(r.fellBack).toBe(true)
    expect(r.fallbackReason).toBe('empty_input')
    expect(messagesCreate).not.toHaveBeenCalled()
  })
})
