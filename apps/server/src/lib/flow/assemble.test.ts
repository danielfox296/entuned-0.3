import { describe, it, expect } from 'vitest'
import { assembleFlowPrompt } from './assemble.js'
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
