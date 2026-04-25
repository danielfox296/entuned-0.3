// Global character cap with clean break. Suno's style field is capped at 1000 chars
// (locked 2026-04-25). Mars must never produce a style longer than this.

export const SUNO_STYLE_CAP = 1000

/**
 * Truncate a comma-fragment style string at or before `max` chars, breaking on the last
 * comma if possible (else last whitespace). Strips trailing punctuation.
 */
export function capStyle(s: string, max: number): string {
  if (s.length <= max) return s.trim()
  const cut = s.slice(0, max)
  const lastComma = cut.lastIndexOf(',')
  const lastSpace = cut.lastIndexOf(' ')
  // Prefer comma break if reasonably close to the cap; else last whitespace.
  const breakAt = lastComma > max * 0.8 ? lastComma : (lastSpace > max * 0.8 ? lastSpace : max)
  return cut.slice(0, breakAt).replace(/[,\s.]+$/, '').trim()
}
