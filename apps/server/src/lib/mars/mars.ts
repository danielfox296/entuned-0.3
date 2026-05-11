// Card 12 Mars (Style Builder) — assembles the Suno style portion deterministically.
// Input: a StyleAnalysis (Card 5). Song Outcome Specs live on Suno's other params,
// not in the style portion (locked 2026-04-25 after Daniel's Suno reality check).
//
// Output: { style, negativeStyle, vocalGender, firedExclusionRuleIds, styleTemplateVersion }
//
// Three builder strategies, selectable via STYLE_BUILDER env var:
//   - 'router'  (default) — LLM-routed extractive slot composition (style-router.ts)
//   - 'legacy'             — pure concat of decomp prose fields (style-template-v1.ts)
//   - 'anchor'             — Anchor-and-Carve: genre tag + surgical positives + curated
//                            negative-style additions (style-anchor.ts). Built 2026-05-10
//                            after live Suno testing showed genre tags are the dominant
//                            signal and most technical vocabulary is ignored.
//
// All three produce the same MarsOutput shape. The anchor strategy additionally
// contributes sub-attractors that get merged into the rule-fired negative-style output
// so the existing protections (always-fire contamination, 5-axis exclusions, DB rules)
// are preserved.

import type { StyleAnalysis, Outcome } from '@prisma/client'
import { assembleStylePortion, getStyleTemplateVersion } from './style-template-v1.js'
import { routeStylePortion, getRouterVersion } from './style-router.js'
import { buildAnchorStyle, getAnchorVersion } from './style-anchor.js'
import { extractVocalGender, type VocalGender } from './vocal-gender.js'
import { buildNegativeStyle, NEGATIVE_STYLE_HARD_CAP, capJoined } from './style-exclusion-rules.js'

export type StyleBuilderName = 'router' | 'legacy' | 'anchor'

export interface MarsOutput {
  style: string
  negativeStyle: string
  vocalGender: VocalGender
  firedExclusionRuleIds: string[]
  styleTemplateVersion: number
  /** Which builder produced `style`. */
  styleBuilder: StyleBuilderName
  /** Legacy concat output, always recomputed for QC parity. Equals `style` when builder=legacy. */
  styleLegacy: string
  /** Anchor metadata when builder=anchor; otherwise null. */
  anchor?: { tag: string; corrections: string[]; negativeAdditions: string[] } | null
}

export interface MarsOptions {
  /** Track release year — passed to the router/anchor to anchor era extractively. */
  year?: number | null
  /** Override the global STYLE_BUILDER env var for this assembly. Lets callers (e.g.,
   *  the operator dropdown in Dash → Song Creation Queue) pick a strategy per batch. */
  styleBuilder?: StyleBuilderName
}

/**
 * Merge anchor-strategy sub-attractors into the rule-fired negative-style output.
 * Anchor additions go FIRST so they survive truncation — they're the most
 * strategically chosen for this specific track's centroid drifts.
 */
function mergeNegativeStyle(existing: string, additions: string[]): string {
  if (additions.length === 0) return existing
  const trimmedAdditions = additions.map((s) => s.trim()).filter(Boolean)
  const existingTerms = existing.split(',').map((s) => s.trim()).filter(Boolean)
  const merged: string[] = []
  const seen = new Set<string>()
  for (const t of [...trimmedAdditions, ...existingTerms]) {
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(t)
  }
  return capJoined(merged, NEGATIVE_STYLE_HARD_CAP)
}

export async function marsAssemble(
  styleAnalysis: StyleAnalysis,
  _outcome?: Outcome,
  opts: MarsOptions = {},
): Promise<MarsOutput> {
  const builder = opts.styleBuilder ?? ((process.env.STYLE_BUILDER ?? 'router') as StyleBuilderName)
  const styleLegacy = assembleStylePortion({ decomposition: styleAnalysis as any })

  let style: string
  let styleTemplateVersion: number
  let anchorMeta: MarsOutput['anchor'] = null
  let anchorNegativeAdditions: string[] = []

  if (builder === 'router') {
    const routed = await routeStylePortion(styleAnalysis, { year: opts.year ?? null })
    style = routed.style
    styleTemplateVersion = getRouterVersion()
  } else if (builder === 'anchor') {
    const anchored = await buildAnchorStyle(styleAnalysis, { year: opts.year ?? null })
    style = anchored.style
    styleTemplateVersion = getAnchorVersion()
    anchorNegativeAdditions = anchored.negativeAdditions
    anchorMeta = {
      tag: anchored.anchor,
      corrections: anchored.corrections,
      negativeAdditions: anchored.negativeAdditions,
    }
  } else {
    style = styleLegacy
    styleTemplateVersion = getStyleTemplateVersion()
  }

  const { negativeStyle: ruleFiredNeg, firedRuleIds } = await buildNegativeStyle(styleAnalysis as any)
  const negativeStyle = mergeNegativeStyle(ruleFiredNeg, anchorNegativeAdditions)

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
    anchor: anchorMeta,
  }
}
