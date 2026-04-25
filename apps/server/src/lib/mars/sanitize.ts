// Strip tempo and mode/key from any text fragment before it enters the Suno style prompt.
// Outcome owns tempo + mode (per supremacy rule). They are NOT passed to the style prompt
// at all — Suno reads those from its own params. Keeping them in the style risks conflict.
//
// Locked 2026-04-25 per Daniel's directive.

/**
 * Patterns we strip from decomposition fields:
 *   - "115 BPM", "92 bpm", "at 90 BPM"
 *   - "F# minor", "G major", "C minor key", "major key", "minor key" (when standalone)
 *   - "in F# minor", "in the key of G"
 *   - "Eb major", "Bb minor"
 */
const BPM_RE = /(?:\bat\s+)?\b\d{2,3}\s*-?\s*bpm\b/gi
const KEY_RE = /\b(?:in\s+(?:the\s+key\s+of\s+)?)?(?:[A-G](?:[#b])?)\s+(?:major|minor|maj|min)(?:\s+key)?\b/gi
const STANDALONE_MODE_RE = /\b(?:major|minor)\s+key\b/gi

export function stripTempoAndKey(text: string | null | undefined): string {
  if (!text) return ''
  let s = text
  s = s.replace(BPM_RE, '')
  s = s.replace(KEY_RE, '')
  s = s.replace(STANDALONE_MODE_RE, '')
  // Clean up artifacts: dangling commas, double spaces, comma-comma.
  s = s.replace(/\s*,\s*,/g, ',')
  s = s.replace(/,\s*\./g, '.')
  s = s.replace(/\s+/g, ' ')
  s = s.replace(/\s*,\s*$/g, '')
  return s.trim()
}
