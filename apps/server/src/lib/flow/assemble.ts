// Assemble the final Flow payload from the deterministic timeline + the renderer's
// prose. PURE — no DB, no LLM. This is the join point where the two halves meet:
// the timeline owns the verbatim lyrics and timestamps; the renderer owns the
// sound-world prose and per-slot production descriptions.
//
// Storage mapping (engine-native, no canonical form):
//   - style  = the sound-world paragraph  → SongSeed.style
//   - lyrics = the [mm:ss] timeline with descriptions + verbatim lyric lines
//              → SongSeed.lyrics
// The eventual Flow submission step concatenates style + "\n\n" + lyrics.
//
// flowmusic.app's Lyrics box hard-rejects input above 3000 chars (it doesn't
// truncate — it drops the value). So the assembled lyrics are capped at
// FLOW_LYRICS_CAP. When over, we shrink the production DESCRIPTIONS (proportionally)
// and NEVER drop a slot or a lyric line — verbatim hook lines are sacred.
//
// Degrades gracefully: if the renderer fell back (empty soundWorld / no
// descriptions), style uses the caller's fallback and slots render with a bare
// label, so a valid prompt is produced from the timeline alone.

import type { FlowTimeline } from './timeline.js'
import type { FlowRendererOutput } from './renderer.js'
import { clampProse } from './renderer.js'

/** flowmusic.app Lyrics box maxLength. Input above this is rejected outright. */
export const FLOW_LYRICS_CAP = 3000

export interface FlowPrompt {
  style: string
  lyrics: string
}

function mmss(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function assembleFlowPrompt(
  timeline: FlowTimeline,
  renderer: FlowRendererOutput,
  fallbackSoundWorld: string,
  maxLyricsChars: number = FLOW_LYRICS_CAP,
): FlowPrompt {
  const style = renderer.soundWorld.trim() || fallbackSoundWorld.trim()

  // Split each slot into its fixed part (timestamp header + verbatim lyric block,
  // which must never shrink) and its variable part (the production description).
  const parts = timeline.slots.map((slot) => {
    const rendered = renderer.sectionDescriptions[slot.index]?.trim()
    const desc = rendered || (slot.kind === 'instrumental' ? `${slot.label} (instrumental)` : slot.label)
    const head = `[${mmss(slot.startSec)}] `
    const body = slot.lyricLines.length > 0 ? `\nLyrics:\n${slot.lyricLines.join('\n')}` : ''
    return { head, desc, body }
  })

  const SEP = '\n\n'
  const sepCost = Math.max(0, parts.length - 1) * SEP.length
  const fixed = parts.reduce((n, p) => n + p.head.length + p.body.length, 0) + sepCost
  const descTotal = parts.reduce((n, p) => n + p.desc.length, 0)

  if (fixed + descTotal > maxLyricsChars) {
    // Distribute the room left after the fixed cost across the descriptions,
    // proportional to their length. Reserve 1 char/slot for clampProse ellipses.
    const avail = Math.max(0, maxLyricsChars - fixed - parts.length)
    for (const p of parts) {
      const budget = descTotal > 0 ? Math.floor(avail * (p.desc.length / descTotal)) : 0
      p.desc = clampProse(p.desc, Math.max(0, budget))
    }
  }

  let lyrics = parts.map((p) => p.head + p.desc + p.body).join(SEP)

  // Final guard for pathological lyric-heavy input (fixed cost alone near the cap):
  // cut whole blocks from the end at a clean boundary. Within kept blocks, lyric
  // lines stay intact. Should effectively never fire on real Professor output.
  if (lyrics.length > maxLyricsChars) {
    const cut = lyrics.lastIndexOf(SEP, maxLyricsChars)
    lyrics = lyrics.slice(0, cut > 0 ? cut : maxLyricsChars)
  }

  return { style, lyrics }
}
