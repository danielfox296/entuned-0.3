import { describe, it, expect } from 'vitest'
import {
  bpmCompatible,
  vocalGenderCompatible,
  extractGenreBrief,
  extractModeHint,
  modeCompatible,
  stripFlavorAnnotations,
  OUTCOME_TEMPO_TOLERANCE_BPM,
} from './eno.js'
import type { StyleAnalysis } from '@prisma/client'

describe('bpmCompatible — outcome tempo gate', () => {
  it('passes when ref BPM is within ±7 of the outcome tempo', () => {
    expect(bpmCompatible(75, 75)).toBe(true)
    expect(bpmCompatible(82, 75)).toBe(true)
    expect(bpmCompatible(68, 75)).toBe(true)
  })

  it('rejects when ref BPM is more than 7 off the outcome tempo', () => {
    expect(bpmCompatible(83, 75)).toBe(false)
    expect(bpmCompatible(67, 75)).toBe(false)
    // The metal-vs-browsing case
    expect(bpmCompatible(145, 75)).toBe(false)
  })

  it('exposes the tolerance as a constant so it can be tuned in one place', () => {
    expect(OUTCOME_TEMPO_TOLERANCE_BPM).toBe(7)
  })

  it('passes when ref BPM is null/undefined — backfill is lazy on re-decompose', () => {
    expect(bpmCompatible(null, 75)).toBe(true)
    expect(bpmCompatible(undefined, 75)).toBe(true)
  })

  it('treats the boundary as inclusive (off-by-7 still passes)', () => {
    expect(bpmCompatible(82, 75)).toBe(true)
    expect(bpmCompatible(68, 75)).toBe(true)
    expect(bpmCompatible(83, 75)).toBe(false)
    expect(bpmCompatible(67, 75)).toBe(false)
  })
})

describe('vocalGenderCompatible', () => {
  it('excludes instrumental refs regardless of hook gender', () => {
    expect(vocalGenderCompatible('instrumental', null)).toBe(false)
    expect(vocalGenderCompatible('instrumental', 'male')).toBe(false)
    expect(vocalGenderCompatible('instrumental', 'female')).toBe(false)
    expect(vocalGenderCompatible('instrumental', 'duet')).toBe(false)
  })

  it('null hook gender accepts any vocal ref', () => {
    expect(vocalGenderCompatible('male', null)).toBe(true)
    expect(vocalGenderCompatible('female', null)).toBe(true)
    expect(vocalGenderCompatible('duet', null)).toBe(true)
  })

  it('hook duet only accepts duet refs', () => {
    expect(vocalGenderCompatible('duet', 'duet')).toBe(true)
    expect(vocalGenderCompatible('male', 'duet')).toBe(false)
    expect(vocalGenderCompatible('female', 'duet')).toBe(false)
  })

  it('hook male accepts male and duet refs', () => {
    expect(vocalGenderCompatible('male', 'male')).toBe(true)
    expect(vocalGenderCompatible('duet', 'male')).toBe(true)
    expect(vocalGenderCompatible('female', 'male')).toBe(false)
  })
})

describe('extractGenreBrief', () => {
  const baseAnalysis: StyleAnalysis = {
    id: 'sa-1',
    referenceTrackId: 'rt-1',
    styleAnalyzerInstructionsVersion: 10,
    status: 'verified',
    verifiedAt: null,
    verifiedById: null,
    confidence: 'high',
    vibePitch: 'hip-hop, syncopated, modal',
    eraProductionSignature: null,
    instrumentationPalette: null,
    standoutElement: null,
    arrangementShape: null,
    dynamicCurve: null,
    vocalCharacter: 'baritone male with no vibrato',
    vocalArrangement: null,
    harmonicAndGroove: 'modal interchange, syncopated, behind-the-beat',
    arrangementSections: null,
    arrangementVersion: null,
    bpm: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  it('prefers the Mars anchor tag when supplied', () => {
    const brief = extractGenreBrief(baseAnalysis, 2015, 'hip-hop')
    expect(brief.genreTag).toBe('hip-hop')
    expect(brief.eraDecade).toBe('2010s')
    expect(brief.vocalRegister).toBe('baritone')
  })

  it('falls back to the leading vibePitch fragment when no anchor', () => {
    const brief = extractGenreBrief(baseAnalysis, 2015, null)
    expect(brief.genreTag).toBe('hip-hop')
  })

  it('falls back to "pop" when both anchor and vibePitch are absent', () => {
    const brief = extractGenreBrief({ ...baseAnalysis, vibePitch: null }, 2015, null)
    expect(brief.genreTag).toBe('pop')
  })

  it('splits groove terms out of harmonicAndGroove into grooveCharacter', () => {
    const brief = extractGenreBrief(baseAnalysis, 2015, 'hip-hop')
    expect(brief.grooveCharacter).toContain('syncopated')
    expect(brief.grooveCharacter).toContain('behind-the-beat')
    expect(brief.harmonicCharacter).toContain('modal interchange')
  })
})

describe('extractModeHint', () => {
  it('returns null for empty/missing text', () => {
    expect(extractModeHint(null)).toBeNull()
    expect(extractModeHint(undefined)).toBeNull()
    expect(extractModeHint('')).toBeNull()
  })

  it('extracts major from unambiguous major-mode prose', () => {
    expect(extractModeHint('major-key diatonic, mid-tempo')).toBe('major')
    expect(extractModeHint('bright major chords throughout')).toBe('major')
    expect(extractModeHint('Major scale tonality')).toBe('major')
  })

  it('extracts minor from unambiguous minor-mode prose', () => {
    expect(extractModeHint('minor blues, behind-the-beat')).toBe('minor')
    expect(extractModeHint('Minor mode, syncopated')).toBe('minor')
    expect(extractModeHint('natural minor scale')).toBe('minor')
  })

  it('returns null when both major and minor appear (ambiguous)', () => {
    expect(extractModeHint('opens in major, shifts to minor at the bridge')).toBeNull()
  })

  it('returns null when neither token appears (modal / unspecified)', () => {
    expect(extractModeHint('modal dorian, swung pocket')).toBeNull()
    expect(extractModeHint('chromatic passing chords, jazz-inflected')).toBeNull()
  })
})

describe('modeCompatible', () => {
  it('passes when refMode is unknown — conservative gate', () => {
    expect(modeCompatible(null, 'major')).toBe(true)
    expect(modeCompatible(null, 'minor')).toBe(true)
    expect(modeCompatible(null, 'modal dorian')).toBe(true)
  })

  it('passes when outcomeMode does not clearly name a key', () => {
    expect(modeCompatible('major', 'modal')).toBe(true)
    expect(modeCompatible('minor', 'dorian')).toBe(true)
    expect(modeCompatible('major', '')).toBe(true)
  })

  it('matches major-to-major and minor-to-minor', () => {
    expect(modeCompatible('major', 'major')).toBe(true)
    expect(modeCompatible('minor', 'minor')).toBe(true)
  })

  it('rejects when refMode and outcomeMode disagree', () => {
    expect(modeCompatible('major', 'minor')).toBe(false)
    expect(modeCompatible('minor', 'major')).toBe(false)
  })

  it('passes when outcomeMode mentions both — no clear ask', () => {
    expect(modeCompatible('major', 'major or minor')).toBe(true)
    expect(modeCompatible('minor', 'major or minor')).toBe(true)
  })
})

describe('stripFlavorAnnotations', () => {
  it('strips flavor parens like "(groove establishes)"', () => {
    expect(stripFlavorAnnotations('[Intro] (groove establishes), [Verse 1]'))
      .toBe('[Intro], [Verse 1]')
  })

  it('strips multi-clause flavor parens', () => {
    expect(stripFlavorAnnotations('[Verse 1], [Chorus], [Tag] (half-time, hook only, sustained)'))
      .toBe('[Verse 1], [Chorus], [Tag]')
  })

  it('preserves "(optional)" annotations — they carry lyric-time semantics', () => {
    const input = '[Intro] (optional), [Verse 1], [Pre-Chorus] (optional), [Chorus]'
    expect(stripFlavorAnnotations(input)).toBe(input)
  })

  it('preserves "(optional)" while stripping flavor in the same string', () => {
    expect(stripFlavorAnnotations('[Intro] (groove establishes), [Verse 1], [Pre-Chorus] (optional), [Chorus]'))
      .toBe('[Intro], [Verse 1], [Pre-Chorus] (optional), [Chorus]')
  })

  it('strips em-dash-laden flavor (intro_driven case)', () => {
    expect(stripFlavorAnnotations('[Intro] (extended — sets the mood for ~8-12 bars before any vocal), [Verse 1]'))
      .toBe('[Intro], [Verse 1]')
  })

  it('leaves vanilla section lists untouched', () => {
    expect(stripFlavorAnnotations('[Verse 1], [Verse 2], [Bridge], [Verse 3]'))
      .toBe('[Verse 1], [Verse 2], [Bridge], [Verse 3]')
  })
})
