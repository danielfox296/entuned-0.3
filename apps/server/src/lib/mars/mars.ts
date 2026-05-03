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
import { routeStylePortion, getRouterVersion } from './style-router.js'
import { extractVocalGender, type VocalGender } from './vocal-gender.js'
import { buildNegativeStyle } from './style-exclusion-rules.js'

export interface MarsOutput {
  style: string
  negativeStyle: string
  vocalGender: VocalGender
  firedExclusionRuleIds: string[]
  styleTemplateVersion: number
  /** Which builder produced `style`. "router" (default) or "legacy". */
  styleBuilder: 'router' | 'legacy'
  /** Legacy concat output, always recomputed for QC parity. Equals `style` when builder=legacy. */
  styleLegacy: string
}

export interface MarsOptions {
  /** Track release year — passed to the router to anchor era extractively. */
  year?: number | null
}

export async function marsAssemble(
  styleAnalysis: StyleAnalysis,
  _outcome?: Outcome,
  opts: MarsOptions = {},
): Promise<MarsOutput> {
  const builder = (process.env.STYLE_BUILDER ?? 'router') as 'router' | 'legacy'
  const styleLegacy = assembleStylePortion({ decomposition: styleAnalysis as any })

  let style: string
  let styleTemplateVersion: number
  if (builder === 'router') {
    const routed = await routeStylePortion(styleAnalysis, { year: opts.year ?? null })
    style = routed.style
    styleTemplateVersion = getRouterVersion()
  } else {
    style = styleLegacy
    styleTemplateVersion = getStyleTemplateVersion()
  }

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
    styleTemplateVersion,
    styleBuilder: builder,
    styleLegacy,
  }
}
