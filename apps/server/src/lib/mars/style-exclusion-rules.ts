// StyleExclusionRule matcher — case-insensitive substring per Q2 (locked 2026-04-25).
// Walks the style_exclusion_rules table, returns matched exclusions concatenated as negative_style,
// plus the ids of rules that fired (for SongSeed.fired_exclusion_rule_ids provenance).

import type { StyleAnalysis, StyleExclusionRule } from '@prisma/client'
import { prisma } from '../../db.js'
import { ALWAYS_FIRE_CONTAMINATION, buildAxisExclusions } from './negative-style-axes.js'

const DECOMPOSITION_FIELD_KEYS = [
  'vibePitch',
  'eraProductionSignature',
  'instrumentationPalette',
  'standoutElement',
  'arrangementShape',
  'dynamicCurve',
  'vocalCharacter',
  'vocalArrangement',
  'harmonicAndGroove',
] as const

const SNAKE_TO_CAMEL: Record<string, (typeof DECOMPOSITION_FIELD_KEYS)[number]> = {
  vibe_pitch: 'vibePitch',
  era_production_signature: 'eraProductionSignature',
  instrumentation_palette: 'instrumentationPalette',
  standout_element: 'standoutElement',
  arrangement_shape: 'arrangementShape',
  dynamic_curve: 'dynamicCurve',
  vocal_character: 'vocalCharacter',
  vocal_arrangement: 'vocalArrangement',
  harmonic_and_groove: 'harmonicAndGroove',
}

function fieldValue(d: StyleAnalysis, snakeName: string): string {
  if (snakeName === '*') return ''
  const k = SNAKE_TO_CAMEL[snakeName]
  if (!k) return ''
  const v = (d as any)[k]
  return typeof v === 'string' ? v : ''
}

function ciContains(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export interface NegativeStyleResult {
  negativeStyle: string
  firedRuleIds: string[]
  /** Axis tags from the 5-axis builder that contributed fragments, for provenance. */
  firedAxes: string[]
}

export async function buildNegativeStyle(styleAnalysis: StyleAnalysis): Promise<NegativeStyleResult> {
  const rules: StyleExclusionRule[] = await prisma.styleExclusionRule.findMany()
  const fragments: string[] = []
  const firedRuleIds: string[] = []

  for (const rule of rules) {
    if (rule.overrideField && rule.overridePattern) {
      const overrideValue = fieldValue(styleAnalysis, rule.overrideField)
      if (ciContains(overrideValue, rule.overridePattern)) continue
    }

    let fires = false
    if (rule.triggerField === '*') {
      fires = true
    } else {
      const fieldVal = fieldValue(styleAnalysis, rule.triggerField)
      fires = ciContains(fieldVal, rule.triggerValue)
    }

    if (fires) {
      fragments.push(rule.exclude)
      firedRuleIds.push(rule.id)
    }
  }

  // Always-fire contamination words — Suno mis-triggers on these regardless of context.
  fragments.push(ALWAYS_FIRE_CONTAMINATION.join(', '))

  // 5-axis builder — opposite genre/instruments/vocal/mood/production + adjacent contamination.
  const axes = buildAxisExclusions(styleAnalysis)
  if (axes.fragments.length > 0) {
    fragments.push(axes.fragments.join(', '))
  }

  // Dedupe overlapping exclude strings (different sources sometimes name the same drift).
  const merged = Array.from(new Set(fragments.flatMap((f) => f.split(',').map((s) => s.trim()).filter(Boolean))))

  // Soft cap. Suno's exclude box accepts ~500–1000 chars but external research
  // recommends ~180–200 for efficiency — past that, fragments dilute each other.
  // We cap at 400 to leave headroom while staying close to the recommended range.
  // DB rules go in first (most specific to the track), then always-fire, then axes;
  // the cap drops axis fragments first, since they're the most generic of the three.
  const negativeStyle = capJoined(merged, NEGATIVE_STYLE_HARD_CAP)

  return {
    negativeStyle,
    firedRuleIds,
    firedAxes: axes.axesFired,
  }
}

const NEGATIVE_STYLE_HARD_CAP = 400

/** Join terms with ", " up to `cap` chars, preserving full terms (never mid-word). */
function capJoined(terms: string[], cap: number): string {
  let out = ''
  for (const t of terms) {
    const candidate = out.length === 0 ? t : `${out}, ${t}`
    if (candidate.length > cap) break
    out = candidate
  }
  return out
}
