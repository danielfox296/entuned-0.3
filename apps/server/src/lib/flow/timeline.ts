// Flow timeline builder — the Google Flow (Lyria) counterpart to the Suno
// arranger's injectArrangement.
//
// Where the Suno arranger staples [Section | tag] brackets onto Bernie's lyric,
// Flow wants a TIMESTAMPED scaffold spanning a target duration. Two product goals
// drive this:
//   1. Guarantee a longer song — timestamps spanning ~3:00 push Lyria past its
//      short-render default instead of stopping at ~1 min.
//   2. Lower lyric density — the same lyric lines spread across more wall-clock,
//      with instrumental gaps between sections, means fewer words per unit time.
//      Lyric over-density is a chronic struggle; the timeline is the lever.
//
// This module is PURE (no DB, no LLM, no env) — same discipline as arranger.ts.
// eno loads the FlowTimelinePolicy from the DB and passes the config in; tests
// pass a literal. The builder OWNS the verbatim lyric lines: they are carried as
// data on each slot and never handed to an LLM, so the Flow renderer (which only
// writes production descriptions keyed by slot index) cannot corrupt a hook line.

import type { SectionDirective, ArrangementSections } from '../arranger/arranger.js'
import { parseLyricSections, type SectionKey, type ChorusRank } from '../arranger/section-parse.js'

// Operator-tunable Flow timeline policy. Stored as JSON in FlowTimelinePolicy.config;
// seeded with FLOW_TIMELINE_POLICY_SEED. Kept SEPARATE from the Suno ArrangementConfig
// so the two engines' tuning never couples.
export interface FlowTimelineConfig {
  /** Total song-length target in seconds. ~180 pushes Lyria past its short default. */
  targetDurationSec: number
  /** Relative time weight per section type — chorus longer is correct (energy peak).
   *  `default` applies to unrecognized headers (e.g. [Hook], [Interlude]). */
  sectionWeights: Record<SectionKey, number> & { default: number }
  /** Instrumental breathing room reserved before each section after the first.
   *  This is the primary density-relief lever — bigger gaps = sparser singing. */
  interSectionGapSec: number
  /** A leading instrumental run before the first vocal section. 0 disables. */
  introInstrumentalSec: number
  /** Carry-out: when the song ends on a chorus, append a trailing instrumental
   *  run so Lyria lands instead of stopping cold (mirrors the Suno outro). */
  outroOnChorusEnd: { enabled: boolean; instrumentalSec: number }
}

export const FLOW_TIMELINE_POLICY_SEED: FlowTimelineConfig = {
  targetDurationSec: 180,
  sectionWeights: {
    intro: 0.6,
    verse: 1.0,
    pre_chorus: 0.6,
    chorus: 1.2,
    bridge: 1.0,
    outro: 0.8,
    default: 1.0,
  },
  interSectionGapSec: 4,
  introInstrumentalSec: 8,
  outroOnChorusEnd: { enabled: true, instrumentalSec: 12 },
}

export interface TimelineSlot {
  /** 0-based stable index — the key the Flow renderer uses to attach a
   *  production description to this slot without ever touching its lyric. */
  index: number
  kind: 'section' | 'instrumental'
  /** Canonical section key; null for unrecognized headers and instrumental slots. */
  key: SectionKey | null
  /** Display label, e.g. "Verse 1", "Final Chorus", "Intro", "Outro". */
  label: string
  /** Start offset in whole seconds. */
  startSec: number
  /** Verbatim lyric lines for this slot (empty for instrumental slots). */
  lyricLines: string[]
  /** The reference track's per-type directive for this section, if any —
   *  carried for the renderer so it can describe instrumentation/density. */
  directive?: SectionDirective
  /** Chorus rank, present only on chorus slots, so the renderer knows the peak. */
  chorusRank?: ChorusRank
}

export interface FlowTimeline {
  slots: TimelineSlot[]
  totalDurationSec: number
}

export interface BuildFlowTimelineInput {
  lyrics: string
  arrangementSections: ArrangementSections
  config: FlowTimelineConfig
}

/** Build a timestamped Flow timeline from a (post-Professor) lyric. The lyric is
 *  the spine: sections come from parseLyricSections, time is allocated by section
 *  weight across the configured target duration, with instrumental intro / gaps /
 *  outro reserved. Verbatim lyric lines ride along on each section slot. */
export function buildFlowTimeline(input: BuildFlowTimelineInput): FlowTimeline {
  const { lyrics, arrangementSections, config } = input
  const blocks = parseLyricSections(lyrics)

  // Degenerate input (no recognizable sections): emit one instrumental slot so
  // the prompt is still well-formed. Should not happen on real Professor output.
  if (blocks.length === 0) {
    return {
      slots: [{ index: 0, kind: 'instrumental', key: null, label: 'Instrumental', startSec: 0, lyricLines: [] }],
      totalDurationSec: Math.round(config.targetDurationSec),
    }
  }

  const endsOnChorus = blocks[blocks.length - 1].key === 'chorus'
  const reservedIntro = Math.max(0, config.introInstrumentalSec)
  const reservedOutro = endsOnChorus && config.outroOnChorusEnd.enabled
    ? Math.max(0, config.outroOnChorusEnd.instrumentalSec)
    : 0
  const gapCount = Math.max(0, blocks.length - 1)
  const reservedGaps = gapCount * Math.max(0, config.interSectionGapSec)
  const singingBudget = Math.max(
    blocks.length, // floor: at least ~1s of singing per section so timing never collapses
    config.targetDurationSec - reservedIntro - reservedOutro - reservedGaps,
  )

  const weightFor = (key: SectionKey | null): number =>
    (key && config.sectionWeights[key]) || config.sectionWeights.default
  const weights = blocks.map((b) => weightFor(b.key))
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1

  const slots: TimelineSlot[] = []
  let cursor = 0
  let index = 0

  if (reservedIntro > 0) {
    slots.push({ index: index++, kind: 'instrumental', key: 'intro', label: 'Intro', startSec: 0, lyricLines: [] })
    cursor = reservedIntro
  }

  blocks.forEach((block, i) => {
    if (i > 0) cursor += config.interSectionGapSec // instrumental breathing room before this section
    const isFinal = block.chorusRank?.isFinal ?? false
    const label = isFinal && !block.headerRaw.toLowerCase().includes('final') ? 'Final Chorus' : block.headerRaw
    slots.push({
      index: index++,
      kind: 'section',
      key: block.key,
      label,
      startSec: Math.round(cursor),
      lyricLines: block.lines,
      directive: block.key ? arrangementSections[block.key] : undefined,
      chorusRank: block.chorusRank,
    })
    cursor += singingBudget * (weights[i] / weightSum)
  })

  if (reservedOutro > 0) {
    slots.push({ index: index++, kind: 'instrumental', key: 'outro', label: 'Outro', startSec: Math.round(cursor), lyricLines: [] })
    cursor += reservedOutro
  }

  return { slots, totalDurationSec: Math.round(cursor) }
}
