import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the SDK so getAnthropic() constructs a stand-in (and so the test never
// needs a real key/network). The mock ignores its options — we only assert
// construction happens / the key guard fires.
const anthropicCtor = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    opts: unknown
    constructor(opts: unknown) {
      anthropicCtor(opts)
      this.opts = opts
    }
  }
  return { default: MockAnthropic }
})

import {
  getAnthropic,
  resolveModel,
  extractToolUse,
  _resetAnthropicForTests,
} from './client.js'

describe('resolveModel', () => {
  it('returns the first defined, non-empty candidate', () => {
    expect(resolveModel('first', 'fallback')).toBe('first')
    expect(resolveModel('first', 'second', 'fallback')).toBe('first')
  })

  it('skips undefined candidates and returns the next defined one', () => {
    expect(resolveModel(undefined, 'second', 'fallback')).toBe('second')
  })

  it('skips empty-string candidates (treats "" as unset, like ?? would not)', () => {
    expect(resolveModel('', 'second', 'fallback')).toBe('second')
    expect(resolveModel('', '', 'fallback')).toBe('fallback')
  })

  it('returns the fallback when every candidate is undefined or empty', () => {
    expect(resolveModel(undefined, 'fallback')).toBe('fallback')
    expect(resolveModel(undefined, undefined, 'fallback')).toBe('fallback')
  })

  it('maps the chained X_MODEL ?? Y ?? default pattern', () => {
    // resolveModel(process.env.X_MODEL, process.env.Y, 'default')
    expect(resolveModel(undefined, undefined, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(resolveModel(undefined, 'claude-y', 'claude-sonnet-4-6')).toBe('claude-y')
    expect(resolveModel('claude-x', 'claude-y', 'claude-sonnet-4-6')).toBe('claude-x')
  })
})

describe('extractToolUse', () => {
  const response = {
    content: [
      { type: 'text', text: 'preamble' },
      { type: 'tool_use', name: 'emit_thing', input: { a: 1 } },
      { type: 'tool_use', name: 'other_tool', input: { b: 2 } },
    ],
  }

  it('returns the input of the matching tool_use block', () => {
    expect(extractToolUse(response, 'emit_thing')).toEqual({ a: 1 })
  })

  it('matches by name — returns the correct block among several tool_use blocks', () => {
    expect(extractToolUse(response, 'other_tool')).toEqual({ b: 2 })
  })

  it('returns null when no tool_use block has the given name (miss)', () => {
    expect(extractToolUse(response, 'nope')).toBeNull()
  })

  it('does not match a non-tool_use block that happens to share the name', () => {
    const r = { content: [{ type: 'text', name: 'emit_thing', input: { a: 1 } }] }
    expect(extractToolUse(r, 'emit_thing')).toBeNull()
  })

  it('returns null on an empty content array', () => {
    expect(extractToolUse({ content: [] }, 'emit_thing')).toBeNull()
  })
})

describe('getAnthropic', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    anthropicCtor.mockClear()
    _resetAnthropicForTests()
  })

  afterEach(() => {
    // Restore global env so we never leak state to other test files.
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
    _resetAnthropicForTests()
  })

  it('throws when ANTHROPIC_API_KEY is unset', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(() => getAnthropic()).toThrow('ANTHROPIC_API_KEY is not set')
  })

  it('constructs a client with the resolved key when set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const client = getAnthropic()
    expect(client).toBeDefined()
    expect(anthropicCtor).toHaveBeenCalledTimes(1)
    expect(anthropicCtor).toHaveBeenCalledWith({ apiKey: 'test-key' })
  })

  it('memoizes — repeated calls reuse one instance and do not re-construct', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const a = getAnthropic()
    const b = getAnthropic()
    expect(a).toBe(b)
    expect(anthropicCtor).toHaveBeenCalledTimes(1)
  })

  it('does not re-read the key after memoizing (resolves once)', () => {
    process.env.ANTHROPIC_API_KEY = 'first-key'
    const a = getAnthropic()
    // Mutating the env after the first resolve must not affect the cached client.
    process.env.ANTHROPIC_API_KEY = 'second-key'
    const b = getAnthropic()
    expect(a).toBe(b)
    expect(anthropicCtor).toHaveBeenCalledTimes(1)
    expect(anthropicCtor).toHaveBeenCalledWith({ apiKey: 'first-key' })
  })
})
