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
// Degrades gracefully: if the renderer fell back (empty soundWorld / no
// descriptions), style uses the caller's fallback and slots render with a bare
// label, so a valid prompt is produced from the timeline alone.

import type { FlowTimeline } from './timeline.js'
import type { FlowRendererOutput } from './renderer.js'

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
): FlowPrompt {
  const style = renderer.soundWorld.trim() || fallbackSoundWorld.trim()

  const blocks: string[] = []
  for (const slot of timeline.slots) {
    const desc = renderer.sectionDescriptions[slot.index]?.trim()
    const fallbackDesc = slot.kind === 'instrumental' ? `${slot.label} (instrumental)` : slot.label
    const header = `[${mmss(slot.startSec)}] ${desc || fallbackDesc}`

    const lines = [header]
    if (slot.lyricLines.length > 0) {
      lines.push('Lyrics:')
      lines.push(...slot.lyricLines)
    }
    blocks.push(lines.join('\n'))
  }

  return { style, lyrics: blocks.join('\n\n') }
}
