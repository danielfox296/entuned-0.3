// Card 12 Mars — assembles the Suno style portion deterministically.
// Input: a Decomposition (Card 5). Outcome physiology lives on Suno's other params,
// not in the style portion (locked 2026-04-25 after Daniel's Suno reality check).
//
// Output: { style, negative_style, vocal_gender, fired_failure_rule_ids, style_template_version }
//
// No LLM. Pure function over data + DB-backed FailureRule table. Outcome is no
// longer a parameter — kept the signature optional for source-compat with older callers
// but it's ignored.

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
  _outcome?: Outcome,
): Promise<MarsOutput> {
  const style = assembleStylePortion({ decomposition })
  const { negativeStyle, firedRuleIds } = await buildNegativeStyle(decomposition)
  // Look at both vocal fields for gender hints — a track may have a male lead and a
  // female sample, only one of which gets tagged in vocal_character.
  const vocalText = [decomposition.vocalCharacter, decomposition.vocalArrangement]
    .filter(Boolean)
    .join(' · ')
  const vocalGender = extractVocalGender(vocalText)

  return {
    style,
    negativeStyle,
    vocalGender,
    firedFailureRuleIds: firedRuleIds,
    styleTemplateVersion: getStyleTemplateVersion(),
  }
}
