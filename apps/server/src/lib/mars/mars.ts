// Card 12 Mars — assembles the Suno style portion deterministically.
// Inputs: a Decomposition (Card 5) and a target Outcome (Card 9).
// Outputs: { style, negative_style, vocal_gender, fired_failure_rule_ids, style_template_version }
//
// No LLM. Pure function over data + DB-backed FailureRule table.

import type { Decomposition, Outcome } from '@prisma/client'
import { assembleStylePortion, getStyleTemplateVersion } from './style-template-v1.js'
import { extractVocalGender, type VocalGender } from './vocal-gender.js'
import { buildNegativeStyle } from './failure-rules.js'

export interface MarsOutput {
  style: string
  negativeStyle: string
  vocalGender: VocalGender
  firedFailureRuleIds: string[]
  styleTemplateVersion: number
}

export async function marsAssemble(
  decomposition: Decomposition,
  outcome: Outcome,
): Promise<MarsOutput> {
  const style = assembleStylePortion({ decomposition, outcome })
  const { negativeStyle, firedRuleIds } = await buildNegativeStyle(decomposition)
  const vocalGender = extractVocalGender(decomposition.vocalCharacter)

  return {
    style,
    negativeStyle,
    vocalGender,
    firedFailureRuleIds: firedRuleIds,
    styleTemplateVersion: getStyleTemplateVersion(),
  }
}
