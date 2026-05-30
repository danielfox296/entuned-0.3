import { describe, it, expect } from 'vitest'
import { assembleFlowPrompt, FLOW_LYRICS_CAP } from './assemble.js'
import { buildFlowTimeline, FLOW_TIMELINE_POLICY_SEED } from './timeline.js'
import type { FlowRendererOutput } from './renderer.js'

const LYRICS = `[Verse 1]
I set the table for two every night

[Chorus]
walking away from the ghost of you`

const TIMELINE = buildFlowTimeline({ lyrics: LYRICS, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })

const RENDERED: FlowRendererOutput = {
  soundWorld: 'An energetic 1970s soul track at 94 BPM.',
  sectionDescriptions: Object.fromEntries(TIMELINE.slots.map((s) => [s.index, `desc ${s.label}`])),
  personaVersion: 1,
  fellBack: false,
}

describe('assembleFlowPrompt', () => {
  it('puts sound-world prose in style and the timeline in lyrics', () => {
    const out = assembleFlowPrompt(TIMELINE, RENDERED, 'fallback')
    expect(out.style).toBe('An energetic 1970s soul track at 94 BPM.')
    expect(out.lyrics).toContain('[00:00]')
    expect(out.lyrics).toContain('Lyrics:')
  })

  it('places verbatim lyric lines under their section timestamps', () => {
    const out = assembleFlowPrompt(TIMELINE, RENDERED, 'fallback')
    expect(out.lyrics).toContain('I set the table for two every night')
    expect(out.lyrics).toContain('walking away from the ghost of you')
  })

  it('emits monotonic [mm:ss] timestamps', () => {
    const out = assembleFlowPrompt(TIMELINE, RENDERED, 'fallback')
    const stamps = [...out.lyrics.matchAll(/\[(\d\d):(\d\d)\]/g)].map(([, m, s]) => Number(m) * 60 + Number(s))
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThan(stamps[i - 1])
  })

  it('uses the fallback sound-world when the renderer returned none', () => {
    const fellBack: FlowRendererOutput = { soundWorld: '', sectionDescriptions: {}, personaVersion: 1, fellBack: true }
    const out = assembleFlowPrompt(TIMELINE, fellBack, 'a 1970s soul track, energetic, 94bpm')
    expect(out.style).toBe('a 1970s soul track, energetic, 94bpm')
    // slots still render with their labels as the description
    expect(out.lyrics).toContain('[00:00]')
    expect(out.lyrics).toContain('I set the table for two every night')
  })

  it('does not attach a Lyrics block to instrumental slots', () => {
    const out = assembleFlowPrompt(TIMELINE, RENDERED, 'fallback')
    const introBlock = out.lyrics.split('\n\n')[0]
    expect(introBlock.startsWith('[00:00]')).toBe(true)
    expect(introBlock).not.toContain('Lyrics:')
  })

  it('falls back to "(instrumental)" labelling when a slot has no description', () => {
    const noDescr: FlowRendererOutput = { soundWorld: 'sw', sectionDescriptions: {}, personaVersion: 1, fellBack: true }
    const out = assembleFlowPrompt(TIMELINE, noDescr, 'fallback')
    expect(out.lyrics.split('\n\n')[0]).toContain('(instrumental)')
  })
})

describe('assembleFlowPrompt — 3000-char Lyrics cap (flowmusic.app)', () => {
  // A realistic worst case: a long-form lyric across many sections, each with a
  // verbose ~700-char production description from the renderer.
  const LONG_LYRICS = Array.from({ length: 8 }, (_, i) =>
    `[Verse ${i + 1}]\nline one of verse ${i + 1} here\nline two of verse ${i + 1} here\n\n[Chorus]\nthe unmistakable hook line ${i + 1}`,
  ).join('\n\n')
  const longTimeline = buildFlowTimeline({ lyrics: LONG_LYRICS, arrangementSections: {}, config: FLOW_TIMELINE_POLICY_SEED })
  const verbose: FlowRendererOutput = {
    soundWorld: 'sw',
    sectionDescriptions: Object.fromEntries(longTimeline.slots.map((s) => [s.index, 'D'.repeat(700) + ' end.'])),
    personaVersion: 1,
    fellBack: false,
  }

  it('never exceeds the cap', () => {
    const out = assembleFlowPrompt(longTimeline, verbose, 'fallback')
    expect(out.lyrics.length).toBeLessThanOrEqual(FLOW_LYRICS_CAP)
  })

  it('preserves every verbatim lyric line (trims descriptions, not lyrics)', () => {
    const out = assembleFlowPrompt(longTimeline, verbose, 'fallback')
    const allLyricLines = longTimeline.slots.flatMap((s) => s.lyricLines)
    for (const line of allLyricLines) {
      expect(out.lyrics).toContain(line)
    }
    // and every hook is present
    for (let i = 1; i <= 8; i++) expect(out.lyrics).toContain(`the unmistakable hook line ${i}`)
  })

  it('keeps all section timestamps (no slot dropped)', () => {
    const out = assembleFlowPrompt(longTimeline, verbose, 'fallback')
    const stamps = out.lyrics.match(/\[\d\d:\d\d\]/g) ?? []
    expect(stamps.length).toBe(longTimeline.slots.length)
  })

  it('does not trim when comfortably under the cap', () => {
    const out = assembleFlowPrompt(TIMELINE, RENDERED, 'fallback')
    expect(out.lyrics).toContain('desc Verse 1')
  })
})
