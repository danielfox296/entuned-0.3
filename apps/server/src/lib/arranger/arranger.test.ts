import { describe, it, expect } from 'vitest'
import { injectArrangement, ARRANGEMENT_POLICY_SEED, type ArrangementConfig } from './arranger.js'

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

const occurrences = (s: string, sub: string) => s.split(sub).length - 1

describe('injectArrangement — chorus escalation (default policy)', () => {
  it('renames the final chorus and adds the final cue + forced energy', () => {
    const out = injectArrangement(VCVC, {})
    expect(out).toContain('[Final Chorus]')
    expect(out).toContain('[Gang vocals on the hook]')
    expect(out).toContain('[Sustained, full]')
  })

  it('gives the 2nd of three choruses the mid cue (stacked harmonies)', () => {
    const lyrics = VCVC + `

[Chorus]
hold the line
hold the line tonight`
    const out = injectArrangement(lyrics, {})
    expect(out).toContain('[Stacked harmonies]')
  })

  it('works with the 2-arg call (policy defaults to the seed)', () => {
    const out = injectArrangement(VCVC, {})
    expect(out).toContain('[Final Chorus]')
  })
})

describe('injectArrangement — outro carry-out', () => {
  it('appends a sustained instrumental outro when the song ends on a chorus', () => {
    const out = injectArrangement(VCVC, {})
    expect(occurrences(out, '[Outro]')).toBe(1)
    // the appended outro lands after the final chorus, at the very end
    expect(out.trimEnd().endsWith('[Sustained, full]')).toBe(true)
    const outroIdx = out.indexOf('[Outro]')
    const finalChorusIdx = out.indexOf('[Final Chorus]')
    expect(outroIdx).toBeGreaterThan(finalChorusIdx)
  })

  it('does NOT append when the song already ends on an [Outro] (e.g. loop form)', () => {
    const loop = `[Verse 1]
move with it

[Chorus]
closer closer

[Instrumental Break]

[Chorus]
closer closer

[Outro]`
    const out = injectArrangement(loop, {})
    expect(occurrences(out, '[Outro]')).toBe(1) // the original, none added
  })

  it('does NOT append after a [Tag] section (e.g. tag_out form)', () => {
    const tagOut = `[Verse 1]
one plain scene

[Chorus]
worth more than they told you

[Final Chorus]
worth more than they told you

[Tag]
worth more than they told you`
    const out = injectArrangement(tagOut, {})
    expect(out).not.toContain('[Outro]')
  })

  it('respects outroOnChorusEnd.enabled = false', () => {
    const policy: ArrangementConfig = {
      ...ARRANGEMENT_POLICY_SEED,
      outroOnChorusEnd: { ...ARRANGEMENT_POLICY_SEED.outroOnChorusEnd, enabled: false },
    }
    const out = injectArrangement(VCVC, {}, policy)
    expect(out).not.toContain('[Outro]')
  })
})

describe('injectArrangement — config-driven cues', () => {
  it('uses a custom final-chorus delivery cue from the policy', () => {
    const policy: ArrangementConfig = {
      ...ARRANGEMENT_POLICY_SEED,
      finalChorus: { ...ARRANGEMENT_POLICY_SEED.finalChorus, deliveryCue: 'whole room sings' },
    }
    const out = injectArrangement(VCVC, {}, policy)
    expect(out).toContain('[Whole room sings]')
    expect(out).not.toContain('[Gang vocals on the hook]')
  })
})
