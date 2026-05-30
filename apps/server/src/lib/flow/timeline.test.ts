import { describe, it, expect } from 'vitest'
import { buildFlowTimeline, FLOW_TIMELINE_POLICY_SEED, type FlowTimelineConfig } from './timeline.js'

const VCVC = `[Verse 1]
I walked out
the door stayed open

[Chorus]
hold the line
hold the line tonight

[Verse 2]
came back late

[Chorus]
hold the line
hold the line tonight`

const VCVB_OUTRO = `[Verse 1]
a line

[Chorus]
the hook

[Bridge]
the turn

[Outro]
fade out`

describe('buildFlowTimeline — structure', () => {
  it('emits an intro instrumental slot, one slot per lyric section, and an outro on chorus end', () => {
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const kinds = tl.slots.map((s) => `${s.kind}:${s.label}`)
    expect(kinds[0]).toBe('instrumental:Intro')
    expect(kinds.slice(1, 5)).toEqual(['section:Verse 1', 'section:Chorus', 'section:Verse 2', 'section:Final Chorus'])
    expect(kinds[kinds.length - 1]).toBe('instrumental:Outro')
  })

  it('places verbatim lyric lines on section slots and none on instrumental slots', () => {
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const sections = tl.slots.filter((s) => s.kind === 'section')
    expect(sections[0].lyricLines).toEqual(['I walked out', 'the door stayed open'])
    expect(sections[1].lyricLines).toEqual(['hold the line', 'hold the line tonight'])
    for (const s of tl.slots.filter((s) => s.kind === 'instrumental')) {
      expect(s.lyricLines).toEqual([])
    }
  })

  it('preserves every lyric line exactly once, in order (hook integrity)', () => {
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const placed = tl.slots.flatMap((s) => s.lyricLines)
    expect(placed).toEqual([
      'I walked out',
      'the door stayed open',
      'hold the line',
      'hold the line tonight',
      'came back late',
      'hold the line',
      'hold the line tonight',
    ])
  })

  it('gives stable 0-based indices for renderer description keying', () => {
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    expect(tl.slots.map((s) => s.index)).toEqual(tl.slots.map((_, i) => i))
  })
})

describe('buildFlowTimeline — timing', () => {
  it('produces strictly monotonic non-negative start offsets within the target', () => {
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const starts = tl.slots.map((s) => s.startSec)
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1])
    expect(starts[0]).toBe(0)
    expect(tl.totalDurationSec).toBeGreaterThan(0)
    // total lands within ~rounding of the configured target
    expect(Math.abs(tl.totalDurationSec - FLOW_TIMELINE_POLICY_SEED.targetDurationSec)).toBeLessThanOrEqual(2)
  })

  it('allocates more time to a chorus than a verse (chorus weight > verse weight)', () => {
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const s = tl.slots
    const verse1 = s.find((x) => x.label === 'Verse 1')!
    const chorus1 = s.find((x) => x.label === 'Chorus')!
    const verse2 = s.find((x) => x.label === 'Verse 2')!
    const verse1Dur = chorus1.startSec - verse1.startSec
    const chorus1Dur = verse2.startSec - chorus1.startSec
    // chorus duration includes the inter-section gap before verse2, but with
    // weight 1.2 vs 1.0 and an equal gap it should still run longer than the verse
    expect(chorus1Dur).toBeGreaterThan(verse1Dur)
  })

  it('lowers density when target duration grows (same lines, more seconds)', () => {
    const short: FlowTimelineConfig = { ...FLOW_TIMELINE_POLICY_SEED, targetDurationSec: 90 }
    const long: FlowTimelineConfig = { ...FLOW_TIMELINE_POLICY_SEED, targetDurationSec: 240 }
    const shortTl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: short })
    const longTl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: long })
    expect(longTl.totalDurationSec).toBeGreaterThan(shortTl.totalDurationSec)
  })

  it('reserves intro and inter-section gap time', () => {
    const noGaps: FlowTimelineConfig = { ...FLOW_TIMELINE_POLICY_SEED, introInstrumentalSec: 0, interSectionGapSec: 0 }
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: noGaps })
    expect(tl.slots[0].kind).toBe('section') // no intro slot when introInstrumentalSec = 0
    expect(tl.slots[0].startSec).toBe(0)
  })
})

describe('buildFlowTimeline — chorus rank parity with the arranger', () => {
  it('marks the last of two inferred choruses as the final chorus', () => {
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const choruses = tl.slots.filter((s) => s.key === 'chorus')
    expect(choruses[0].chorusRank).toEqual({ index: 1, isFinal: false })
    expect(choruses[1].chorusRank).toEqual({ index: 2, isFinal: true })
    expect(choruses[1].label).toBe('Final Chorus')
  })
})

describe('buildFlowTimeline — carry-out', () => {
  it('does NOT append an outro when the song already ends on an [Outro]', () => {
    const tl = buildFlowTimeline({ lyrics: VCVB_OUTRO, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const outroSlots = tl.slots.filter((s) => s.kind === 'instrumental' && s.label === 'Outro')
    // the [Outro] here is a real lyric section, not an appended instrumental
    expect(outroSlots).toHaveLength(0)
    expect(tl.slots[tl.slots.length - 1].label).toBe('Outro')
    expect(tl.slots[tl.slots.length - 1].kind).toBe('section')
  })

  it('respects outroOnChorusEnd.enabled = false', () => {
    const noOutro: FlowTimelineConfig = {
      ...FLOW_TIMELINE_POLICY_SEED,
      outroOnChorusEnd: { ...FLOW_TIMELINE_POLICY_SEED.outroOnChorusEnd, enabled: false },
    }
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: {}, config: noOutro })
    expect(tl.slots.some((s) => s.kind === 'instrumental' && s.label === 'Outro')).toBe(false)
  })
})

describe('buildFlowTimeline — directives + edge cases', () => {
  it('attaches the per-type arrangement directive to section slots', () => {
    const sections = { chorus: { instruments: ['rhodes', 'horns'], density: 'full' as const } }
    const tl = buildFlowTimeline({ lyrics: VCVC, arrangementSections: sections, config: FLOW_TIMELINE_POLICY_SEED })
    const chorus = tl.slots.find((s) => s.key === 'chorus')!
    expect(chorus.directive).toEqual({ instruments: ['rhodes', 'horns'], density: 'full' })
    const verse = tl.slots.find((s) => s.key === 'verse')!
    expect(verse.directive).toBeUndefined()
  })

  it('keeps unrecognized headers as section slots with their lyrics and default weight', () => {
    const withHook = `[Verse 1]
a line

[Hook]
the catchy part`
    const tl = buildFlowTimeline({ lyrics: withHook, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    const hook = tl.slots.find((s) => s.label === 'Hook')!
    expect(hook.kind).toBe('section')
    expect(hook.key).toBeNull()
    expect(hook.lyricLines).toEqual(['the catchy part'])
  })

  it('returns a single instrumental slot for lyric with no headers', () => {
    const tl = buildFlowTimeline({ lyrics: 'just lines\nno headers', arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
    expect(tl.slots).toHaveLength(1)
    expect(tl.slots[0].kind).toBe('instrumental')
  })
})
