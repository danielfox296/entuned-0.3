// Card 12 Mars (Style Builder) — assembles the Suno style portion deterministically.
// Input: a StyleAnalysis (Card 5). Song Outcome Specs live on Suno's other params,
// not in the style portion (locked 2026-04-25 after Daniel's Suno reality check).
//
// Output: { style, negativeStyle, vocalGender, firedExclusionRuleIds, styleTemplateVersion }
//
// No LLM. Pure function over data + DB-backed StyleExclusionRule table. Outcome is no
// longer a parameter — kept the signature optional for source-compat with older callers
// but it's ignored.

import type { StyleAnalysis, Outcome } from '@prisma/client'
import { assembleStylePortion, getStyleTemplateVersion } from './style-template-v1.js'
import { extractVocalGender, type VocalGender } from './vocal-gender.js'
import { buildNegativeStyle } from './failure-rules.js'

export interface MarsOutput {
  style: string
  negativeStyle: string
  vocalGender: VocalGender
  firedExclusionRuleIds: string[]
  styleTemplateVersion: number
}

export async function marsAssemble(
  styleAnalysis: StyleAnalysis,
  _outcome?: Outcome,
): Promise<MarsOutput> {
  const style = assembleStylePortion({ decomposition: styleAnalysis as any })
  const { negativeStyle, firedRuleIds } = await buildNegativeStyle(styleAnalysis as any)
  // Look at both vocal fields for gender hints — a track may have a male lead and a
  // female sample, only one of which gets tagged in vocal_character.
  const vocalText = [styleAnalysis.vocalCharacter, styleAnalysis.vocalArrangement]
    .filter(Boolean)
    .join(' · ')
  const vocalGender = extractVocalGender(vocalText)

  return {
    style,
    negativeStyle,
    vocalGender,
    firedExclusionRuleIds: firedRuleIds,
    styleTemplateVersion: getStyleTemplateVersion(),
  }
}
