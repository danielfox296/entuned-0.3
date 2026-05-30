import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  prisma: {
    flowRendererPersona: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreate }
  }
  return { default: MockAnthropic }
})

import { runFlowRenderer, clampProse, type FlowRendererInput } from './renderer.js'
import { buildFlowTimeline, FLOW_TIMELINE_POLICY_SEED } from './timeline.js'
import { prisma } from '../../db.js'

const personaFindFirst = prisma.flowRendererPersona.findFirst as ReturnType<typeof vi.fn>

const LYRICS = `[Verse 1]
I set the table for two every night
polished the silver you would never see

[Chorus]
walking away from the ghost of you

[Verse 2]
came back late and the lights were low

[Chorus]
walking away and I won't look back`

const TIMELINE = buildFlowTimeline({ lyrics: LYRICS, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })

const SAMPLE_INPUT: FlowRendererInput = {
  decomposition: {
    genreAnchor: '1970s soul',
    eraProductionSignature: 'early-70s analog warmth, tape saturation',
    instrumentationPalette: 'rhodes, upright bass, brushed drums, muted trumpet',
    harmonicCharacter: 'loose diatonic vamps',
    grooveCharacter: 'behind-the-beat, swung',
    vocalCharacter: 'smoky baritone',
    vocalRegister: 'baritone',
  },
  anchorTag: '1970s soul',
  vocalIdentity: 'dark vocal, behind-the-beat delivery, warm recording',
  vocalDescriptor: null,
  harmonicPalette: 'I-IV vamp',
  vocalGender: 'male',
  avoidTerms: ['autotune', 'smooth jazz'],
  outcome: { mood: 'energetic', tempoBpm: 94, mode: 'minor' },
  timeline: TIMELINE,
}

function toolResponse(soundWorld: string, sections: Array<{ index: number; description: string }>) {
  return { content: [{ type: 'tool_use', name: 'emit_flow_prompt', input: { soundWorld, sections } }] }
}

const SOUND_WORLD = 'An energetic 1970s soul track at 94 BPM in a minor key, dripping with early-70s analog warmth.'
const SECTIONS = TIMELINE.slots.map((s) => ({ index: s.index, description: `production for ${s.label}` }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  personaFindFirst.mockResolvedValue({ version: 1, promptText: 'flow renderer persona' })
})

describe('runFlowRenderer — happy path', () => {
  it('returns sound-world prose + index-keyed section descriptions', async () => {
    messagesCreate.mockResolvedValue(toolResponse(SOUND_WORLD, SECTIONS))

    const out = await runFlowRenderer(SAMPLE_INPUT)

    expect(out.soundWorld).toBe(SOUND_WORLD)
    expect(out.personaVersion).toBe(1)
    expect(out.fellBack).toBe(false)
    expect(out.sectionDescriptions[0]).toBe(`production for ${TIMELINE.slots[0].label}`)
    expect(Object.keys(out.sectionDescriptions).length).toBe(TIMELINE.slots.length)
  })

  it('feeds the FULL decomposition + outcome affect into the prompt', async () => {
    messagesCreate.mockResolvedValue(toolResponse(SOUND_WORLD, SECTIONS))

    await runFlowRenderer(SAMPLE_INPUT)

    const msg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(msg).toContain('1970s soul')
    expect(msg).toContain('early-70s analog warmth')
    expect(msg).toContain('rhodes, upright bass')
    expect(msg).toContain('loose diatonic vamps')
    expect(msg).toContain('energetic')
    expect(msg).toContain('94 BPM')
    expect(msg).toContain('minor key')
    // persona is the system prompt
    expect(messagesCreate.mock.calls[0][0].system[0].text).toBe('flow renderer persona')
  })

  it('NEVER sends lyric lines to the model (hook integrity)', async () => {
    messagesCreate.mockResolvedValue(toolResponse(SOUND_WORLD, SECTIONS))

    await runFlowRenderer(SAMPLE_INPUT)

    const msg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(msg).not.toContain('I set the table for two')
    expect(msg).not.toContain('walking away from the ghost')
    // but it DOES tell the model the section roles + that the final chorus is the peak
    expect(msg).toContain('Final Chorus')
    expect(msg).toContain('FINAL')
  })

  it('passes avoid terms as steer-away context (renderer rephrases positively)', async () => {
    messagesCreate.mockResolvedValue(toolResponse(SOUND_WORLD, SECTIONS))

    await runFlowRenderer(SAMPLE_INPUT)

    const msg = messagesCreate.mock.calls[0][0].messages[0].content as string
    expect(msg).toContain('autotune')
    expect(msg).toContain('smooth jazz')
    expect(msg).toContain('AWAY')
  })
})

describe('runFlowRenderer — safety fallbacks (must never block a seed)', () => {
  it('falls back to empty output when the API throws', async () => {
    messagesCreate.mockRejectedValue(new Error('network down'))

    const out = await runFlowRenderer(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('api_error')
    expect(out.soundWorld).toBe('')
    expect(out.sectionDescriptions).toEqual({})
  })

  it('falls back when the model refuses the tool', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'no thanks' }] })

    const out = await runFlowRenderer(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('tool_refusal')
  })

  it('falls back when sound-world comes back empty', async () => {
    messagesCreate.mockResolvedValue(toolResponse('   ', SECTIONS))

    const out = await runFlowRenderer(SAMPLE_INPUT)

    expect(out.fellBack).toBe(true)
    expect(out.fallbackReason).toBe('empty_sound_world')
  })

  it('drops malformed section entries but keeps valid ones', async () => {
    messagesCreate.mockResolvedValue(
      toolResponse(SOUND_WORLD, [
        { index: 0, description: 'good one' },
        { index: 1, description: '   ' } as any,
        { description: 'no index' } as any,
      ]),
    )

    const out = await runFlowRenderer(SAMPLE_INPUT)

    expect(out.fellBack).toBe(false)
    expect(out.sectionDescriptions[0]).toBe('good one')
    expect(out.sectionDescriptions[1]).toBeUndefined()
  })
})

describe('clampProse', () => {
  it('returns the string unchanged when within the cap', () => {
    expect(clampProse('short text.', 100)).toBe('short text.')
  })

  it('cuts at the last sentence boundary when one sits near the end', () => {
    const s = 'Alpha beta gamma. Delta epsilon zeta eta theta iota kappa.'
    const out = clampProse(s, 25)
    expect(out).toBe('Alpha beta gamma.')
  })

  it('falls back to a whole-word boundary + ellipsis when no sentence end fits', () => {
    const s = 'one two three four five six seven eight nine ten eleven twelve'
    const out = clampProse(s, 20)
    expect(out).toBe('one two three four…')
    // the char in the source right after the kept text is a space — a clean cut
    const kept = out.slice(0, -1) // drop the ellipsis
    expect(s[kept.length]).toBe(' ')
  })
})

describe('runFlowRenderer — cold start', () => {
  it('seeds the persona when the table is empty', async () => {
    personaFindFirst.mockResolvedValueOnce(null)
    const personaCreate = prisma.flowRendererPersona.create as ReturnType<typeof vi.fn>
    personaCreate.mockResolvedValue({ version: 1, promptText: 'seeded flow persona' })
    messagesCreate.mockResolvedValue(toolResponse(SOUND_WORLD, SECTIONS))

    const out = await runFlowRenderer(SAMPLE_INPUT)

    expect(personaCreate).toHaveBeenCalledOnce()
    expect(out.personaVersion).toBe(1)
  })
})
