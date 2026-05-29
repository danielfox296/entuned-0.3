import { describe, it, expect } from 'vitest'
import {
  bpmCompatible,
  extractGenreBrief,
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

// vocalGenderCompatible tests removed 2026-05-23 — the vocal-gender gate
// was removed from pickReferenceTrack. Hook.vocalGender still drives Suno
// via the populate-songs vocal toggle; it just no longer narrows the ref
// pool. Ref tracks with any vocal lead (including instrumental) are now
// eligible because Bernie writes the lyrics, not the ref.

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

// extractModeHint and modeCompatible tests removed 2026-05-23 — the mode
// gate was removed from pickReferenceTrack. A song is not a single mode;
// chord progressions mix major and minor chords, and inferring a song-level
// mode from text was lossy. Outcome.mode reaches Suno via the
// OutcomeFactorPrompt prepend — that's the only place mode signaling
// belongs.

