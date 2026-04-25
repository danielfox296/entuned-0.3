// FailureRule matcher — case-insensitive substring per Q2 (locked 2026-04-25).
// Walks the failure_rules table, returns matched exclusions concatenated as negative_style,
// plus the ids of rules that fired (for Submission.fired_failure_rule_ids provenance).

import type { Decomposition, FailureRule } from '@prisma/client'
import { prisma } from '../../db.js'

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

function fieldValue(d: Decomposition, snakeName: string): string {
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
}

export async function buildNegativeStyle(decomposition: Decomposition): Promise<NegativeStyleResult> {
  const rules: FailureRule[] = await prisma.failureRule.findMany()
  const fragments: string[] = []
  const firedRuleIds: string[] = []

  for (const rule of rules) {
    // Override check: if the override field on the decomposition contains the override pattern, skip.
    if (rule.overrideField && rule.overridePattern) {
      const overrideValue = fieldValue(decomposition, rule.overrideField)
      if (ciContains(overrideValue, rule.overridePattern)) continue
    }

    let fires = false
    if (rule.triggerField === '*') {
      fires = true // unconditional
    } else {
      const fieldVal = fieldValue(decomposition, rule.triggerField)
      fires = ciContains(fieldVal, rule.triggerValue)
    }

    if (fires) {
      fragments.push(rule.exclude)
      firedRuleIds.push(rule.id)
    }
  }

  // Dedupe overlapping exclude strings (different rules sometimes name the same drift).
  const merged = Array.from(new Set(fragments.flatMap((f) => f.split(',').map((s) => s.trim()).filter(Boolean))))

  return {
    negativeStyle: merged.join(', '),
    firedRuleIds,
  }
}
