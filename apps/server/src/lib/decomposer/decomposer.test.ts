import { describe, it, expect } from 'vitest'
import {
  toStyleAnalysisData,
  buildEmitTool,
  validate,
  type DecomposeResult,
  type StyleAnalysisOutput,
} from './decomposer.js'

// Minimal DecomposeResult wrapper around a raw model output.
function asResult(output: StyleAnalysisOutput, rulesVersion: number): DecomposeResult {
  return { output, rawText: JSON.stringify(output), modelId: 'test', rulesVersion, eraContext: '' }
}

describe('toStyleAnalysisData — snake→camel mapper (single source of truth)', () => {
  it('maps a v13 structured output into the discrete columns and nulls the legacy prose', () => {
    const out: StyleAnalysisOutput = {
      confidence: 'high',
      instrumentation_palette: 'harpsichord leading, sampled loop anchoring',
      standout_element: 'cycling harpsichord ostinato',
      vocal_character: 'breathy, close-mic, no vibrato',
      genre_anchor: '1990s trip-hop',
      harmonic_character: 'modal interchange, deceptive cadence',
      groove_character: 'mid-tempo behind-the-beat',
      vocal_register: 'soprano',
      vocal_gender: 'female',
      bpm: 77,
      arrangement_sections: { verse: { instruments: ['harpsichord'] } },
    }
    const data = toStyleAnalysisData(asResult(out, 13))
    expect(data.styleAnalyzerInstructionsVersion).toBe(13)
    expect(data.genreAnchor).toBe('1990s trip-hop')
    expect(data.harmonicCharacter).toBe('modal interchange, deceptive cadence')
    expect(data.grooveCharacter).toBe('mid-tempo behind-the-beat')
    expect(data.vocalRegister).toBe('soprano')
    expect(data.vocalGender).toBe('female')
    expect(data.bpm).toBe(77)
    expect(data.arrangementVersion).toBe(13)
    // Legacy prose fields not emitted by v13 → null.
    expect(data.vibePitch).toBeNull()
    expect(data.eraProductionSignature).toBeNull()
    expect(data.harmonicAndGroove).toBeNull()
    expect(data.vocalArrangement).toBeNull()
  })

  it('maps a v12 prose output into the legacy columns and nulls the v13 fields', () => {
    const out = {
      confidence: 'high',
      vibe_pitch: 'late-90s trip-hop with soprano',
      era_production_signature: 'late-90s, room bleed',
      instrumentation_palette: 'harpsichord leading',
      standout_element: 'cycling ostinato',
      vocal_character: 'soprano, breathy',
      vocal_arrangement: 'solo lead',
      harmonic_and_groove: 'modal interchange, behind-the-beat',
    } as StyleAnalysisOutput
    const data = toStyleAnalysisData(asResult(out, 12))
    expect(data.vibePitch).toBe('late-90s trip-hop with soprano')
    expect(data.harmonicAndGroove).toBe('modal interchange, behind-the-beat')
    expect(data.genreAnchor).toBeNull()
    expect(data.harmonicCharacter).toBeNull()
    expect(data.vocalGender).toBeNull()
  })
})

describe('buildEmitTool — version-keyed required set', () => {
  it('v13 requires the structured fields and drops era_production_signature', () => {
    const required = buildEmitTool(13).input_schema.required as string[]
    expect(required).toContain('genre_anchor')
    expect(required).toContain('harmonic_character')
    expect(required).toContain('groove_character')
    expect(required).toContain('vocal_gender')
    expect(required).not.toContain('era_production_signature')
    expect(required).not.toContain('vibe_pitch')
  })

  it('v12 keeps the legacy prose required set', () => {
    const required = buildEmitTool(12).input_schema.required as string[]
    expect(required).toContain('vibe_pitch')
    expect(required).toContain('era_production_signature')
    expect(required).toContain('harmonic_and_groove')
    expect(required).not.toContain('genre_anchor')
  })
})

describe('validate — v13 contract', () => {
  const validV13: StyleAnalysisOutput = {
    confidence: 'high',
    instrumentation_palette: 'harpsichord leading',
    standout_element: 'cycling ostinato',
    vocal_character: 'breathy, close-mic',
    genre_anchor: '1990s trip-hop',
    harmonic_character: 'modal interchange',
    groove_character: 'mid-tempo behind-the-beat',
    vocal_register: 'soprano',
    vocal_gender: 'female',
  }

  it('accepts a complete v13 output', () => {
    expect(() => validate({ ...validV13 }, 13)).not.toThrow()
  })

  it('allows empty vocal_register (instrumental tracks)', () => {
    expect(() => validate({ ...validV13, vocal_gender: 'instrumental', vocal_register: '' }, 13)).not.toThrow()
  })

  it('throws when genre_anchor is missing under v13', () => {
    const { genre_anchor, ...rest } = validV13
    expect(() => validate(rest, 13)).toThrow(/genre_anchor/)
  })

  it('throws on an invalid vocal_gender under v13', () => {
    expect(() => validate({ ...validV13, vocal_gender: 'androgynous' as any }, 13)).toThrow(/vocal_gender/)
  })

  it('does not demand the retired prose fields under v13', () => {
    // vibe_pitch / era_production_signature / harmonic_and_groove absent — still valid.
    expect(() => validate({ ...validV13 }, 13)).not.toThrow()
  })
})
