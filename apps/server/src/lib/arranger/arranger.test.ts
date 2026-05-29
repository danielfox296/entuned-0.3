import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { injectArrangement, ARRANGEMENT_POLICY_SEED, type ArrangementConfig } from './arranger.js'

// The output format is gated by the ARRANGER_FORMAT env var (prod sets it to
// 'pipe'). Pin it per-test so the suite is deterministic regardless of the ambient
// environment — otherwise these legacy-format assertions fail under a 'pipe' build
// (which is exactly what was silently blocking every Railway deploy: the build env
// carries ARRANGER_FORMAT=pipe, so the test gate failed on these tests).
beforeEach(() => {
  vi.stubEnv('ARRANGER_FORMAT', 'legacy')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

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

// Baseline coverage for the format prod actually runs (ARRANGER_FORMAT=pipe). The
// legacy describes above cover the default; this guards the pipe code path so a
// regression there can't ship silently the way the env-var mismatch just did.
describe('injectArrangement — pipe format (ARRANGER_FORMAT=pipe, prod default)', () => {
  beforeEach(() => {
    vi.stubEnv('ARRANGER_FORMAT', 'pipe')
  })

  it('stacks escalation into one pipe-delimited final-chorus header', () => {
    const out = injectArrangement(VCVC, {})
    expect(out).toContain('[Final Chorus | gang vocals on the hook | sustained full]')
    // legacy multi-bracket headers must NOT appear in pipe mode
    expect(out).not.toContain('[Gang vocals on the hook]')
  })

  it('appends a pipe-format sustained outro when the song ends on a chorus', () => {
    const out = injectArrangement(VCVC, {})
    expect(out).toContain('[Outro | sustained full]')
  })

  it('gives the 2nd of three choruses the mid cue inside the pipe header', () => {
    const lyrics = VCVC + `

[Chorus]
hold the line
hold the line tonight`
    const out = injectArrangement(lyrics, {})
    expect(out).toContain('stacked harmonies')
  })
})
