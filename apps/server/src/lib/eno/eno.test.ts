import { describe, it, expect } from 'vitest'
import {
  bpmCompatible,
  extractGenreBrief,
  isDecompositionUsable,
  normalizeStyleAnalysis,
  partitionPickableTracks,
  scoreTrack,
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

  it('BENCHES a null/undefined ref BPM — unknown tempo is not a universal match', () => {
    // Regression: null returning `true` made one null-bpm decomposition eligible
    // for every outcome, win the fast path, and starve lazy decompose — a single
    // track pinned an entire batch (the "Root Down" incident, 2026-05-29).
    expect(bpmCompatible(null, 75)).toBe(false)
    expect(bpmCompatible(undefined, 75)).toBe(false)
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
    genreAnchor: null,
    harmonicCharacter: null,
    grooveCharacter: null,
    vocalRegister: null,
    vocalGender: null,
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

  // --- v13 structured fields: extractGenreBrief prefers the discrete columns ---

  it('prefers the v13 genreAnchor column over the leading vibePitch clause', () => {
    const v13 = { ...baseAnalysis, genreAnchor: '1990s trip-hop', vibePitch: 'something stale' }
    // No Mars anchor passed → genreAnchor column should win over vibePitch extraction.
    expect(extractGenreBrief(v13, 2015, null).genreTag).toBe('1990s trip-hop')
  })

  it('still lets the Mars anchor tag outrank the v13 genreAnchor column', () => {
    const v13 = { ...baseAnalysis, genreAnchor: '1990s trip-hop' }
    expect(extractGenreBrief(v13, 2015, 'neo-soul').genreTag).toBe('neo-soul')
  })

  it('reads discrete harmonicCharacter / grooveCharacter columns when present', () => {
    const v13 = {
      ...baseAnalysis,
      harmonicCharacter: 'deceptive cadence, modal interchange',
      grooveCharacter: 'mid-tempo behind-the-beat pocket',
      harmonicAndGroove: null, // v13 leaves the fused prose field null
    }
    const brief = extractGenreBrief(v13, 2015, 'hip-hop')
    expect(brief.harmonicCharacter).toBe('deceptive cadence, modal interchange')
    expect(brief.grooveCharacter).toBe('mid-tempo behind-the-beat pocket')
  })

  it('prefers the v13 vocalRegister column over scanning vocal_character', () => {
    const v13 = { ...baseAnalysis, vocalRegister: 'soprano', vocalCharacter: 'baritone male with no vibrato' }
    expect(extractGenreBrief(v13, 2015, 'hip-hop').vocalRegister).toBe('soprano')
  })

  it('splits a " | " delimited harmonicAndGroove (the normalized v13 shape)', () => {
    const normalized = {
      ...baseAnalysis,
      harmonicCharacter: null,
      grooveCharacter: null,
      harmonicAndGroove: 'modal interchange, deceptive cadence | mid-tempo behind-the-beat, sampled loop',
    }
    const brief = extractGenreBrief(normalized, 2015, 'hip-hop')
    expect(brief.harmonicCharacter).toBe('modal interchange, deceptive cadence')
    expect(brief.grooveCharacter).toBe('mid-tempo behind-the-beat, sampled loop')
  })
})

describe('normalizeStyleAnalysis — v13 read-time compat shim', () => {
  const base: StyleAnalysis = {
    id: 'sa-2', referenceTrackId: 'rt-2', styleAnalyzerInstructionsVersion: 13, status: 'draft',
    verifiedAt: null, verifiedById: null, confidence: 'high',
    vibePitch: null, eraProductionSignature: null, instrumentationPalette: 'harpsichord leading',
    standoutElement: null, arrangementShape: null, dynamicCurve: null,
    vocalCharacter: 'breathy, close-mic', vocalArrangement: null, harmonicAndGroove: null,
    arrangementSections: null, arrangementVersion: null, bpm: 80,
    genreAnchor: '1990s trip-hop', harmonicCharacter: 'modal interchange, deceptive cadence',
    grooveCharacter: 'mid-tempo behind-the-beat', vocalRegister: 'soprano', vocalGender: 'female',
    createdAt: new Date(), updatedAt: new Date(),
  }

  it('fills vibePitch from genreAnchor when vibePitch is null (v13 row)', () => {
    expect(normalizeStyleAnalysis(base).vibePitch).toBe('1990s trip-hop')
  })

  it('fuses harmonicCharacter + grooveCharacter into harmonicAndGroove with " | "', () => {
    expect(normalizeStyleAnalysis(base).harmonicAndGroove).toBe(
      'modal interchange, deceptive cadence | mid-tempo behind-the-beat',
    )
  })

  it('leaves pre-v13 rows untouched (no v13 columns → no-op)', () => {
    const legacy: StyleAnalysis = {
      ...base, genreAnchor: null, harmonicCharacter: null, grooveCharacter: null,
      vibePitch: 'late-90s trip-hop, melancholy soprano', harmonicAndGroove: 'modal interchange, behind-the-beat',
    }
    const out = normalizeStyleAnalysis(legacy)
    expect(out.vibePitch).toBe('late-90s trip-hop, melancholy soprano')
    expect(out.harmonicAndGroove).toBe('modal interchange, behind-the-beat')
  })

  it('does not overwrite a present vibePitch even if genreAnchor is also set', () => {
    const both = { ...base, vibePitch: 'existing prose' }
    expect(normalizeStyleAnalysis(both).vibePitch).toBe('existing prose')
  })
})

describe('isDecompositionUsable — confidence gate', () => {
  it('rejects low-confidence decompositions (the failed-decompose case)', () => {
    expect(isDecompositionUsable('low')).toBe(false)
  })
  it('accepts medium and high', () => {
    expect(isDecompositionUsable('medium')).toBe(true)
    expect(isDecompositionUsable('high')).toBe(true)
  })
  it('accepts null confidence (legacy rows without a self-report are not blocked)', () => {
    expect(isDecompositionUsable(null)).toBe(true)
    expect(isDecompositionUsable(undefined)).toBe(true)
  })
})

describe('partitionPickableTracks — ready vs. needs-decompose', () => {
  const mk = (sa: { bpm: number | null; confidence: string | null } | null) => ({ styleAnalysis: sa })

  it('puts decomposed + usable + tempo-compatible tracks in ready', () => {
    const { ready, needsDecompose } = partitionPickableTracks([mk({ bpm: 75, confidence: 'high' })], 75)
    expect(ready).toHaveLength(1)
    expect(needsDecompose).toHaveLength(0)
  })

  it('routes never-decomposed tracks to needsDecompose for lazy JIT decompose', () => {
    const { ready, needsDecompose } = partitionPickableTracks([mk(null)], 75)
    expect(ready).toHaveLength(0)
    expect(needsDecompose).toHaveLength(1)
  })

  it('excludes low-confidence rows from BOTH buckets (no pick, no wasteful re-decompose)', () => {
    const { ready, needsDecompose } = partitionPickableTracks([mk({ bpm: 75, confidence: 'low' })], 75)
    expect(ready).toHaveLength(0)
    expect(needsDecompose).toHaveLength(0)
  })

  it('excludes decomposed-but-tempo-incompatible rows from ready (and does not re-decompose them)', () => {
    const { ready, needsDecompose } = partitionPickableTracks([mk({ bpm: 145, confidence: 'high' })], 75)
    expect(ready).toHaveLength(0)
    expect(needsDecompose).toHaveLength(0)
  })

  it('BENCHES a usable decomposition with null bpm — neither ready nor re-decomposed', () => {
    // A decomposed-but-tempo-unknown track is terminally benched: it has a
    // styleAnalysis row (so it is not a lazy-decompose candidate) and its null
    // bpm is no longer a universal match (so it never enters ready). Resolving
    // it requires a re-decompose that yields a real bpm, or a manual bpm.
    const { ready, needsDecompose } = partitionPickableTracks([mk({ bpm: null, confidence: 'high' })], 75)
    expect(ready).toHaveLength(0)
    expect(needsDecompose).toHaveLength(0)
  })

  it('does not let one null-bpm track starve lazy decompose for never-decomposed peers', () => {
    // The Root Down incident in miniature: a usable null-bpm track sits alongside
    // fresh undecomposed tracks. The null-bpm track must NOT occupy ready (which
    // would short-circuit the fast path), and the fresh tracks must still route
    // to needsDecompose so the lazy path can widen the pool.
    const { ready, needsDecompose } = partitionPickableTracks(
      [mk({ bpm: null, confidence: 'high' }), mk(null), mk(null)],
      75,
    )
    expect(ready).toHaveLength(0)
    expect(needsDecompose).toHaveLength(2)
  })
})

describe('scoreTrack — burst spreading', () => {
  it('adds in-flight + accepted seed counts to useCount', () => {
    expect(scoreTrack({ useCount: 2, songSeeds: [{ status: 'queued' }, { status: 'accepted' }] })).toBe(4)
  })
  it('ignores failed seeds in the score', () => {
    expect(scoreTrack({ useCount: 0, songSeeds: [{ status: 'failed' }] })).toBe(0)
  })
})

// extractModeHint and modeCompatible tests removed 2026-05-23 — the mode
// gate was removed from pickReferenceTrack. A song is not a single mode;
// chord progressions mix major and minor chords, and inferring a song-level
// mode from text was lossy. Outcome.mode reaches Suno via the
// OutcomeFactorPrompt prepend — that's the only place mode signaling
// belongs.

