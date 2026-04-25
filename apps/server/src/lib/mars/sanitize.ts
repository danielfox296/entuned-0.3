// Sanitizer for Suno-bound text. Strips:
//   - Tempo/mode/key (Outcome owns these — Daniel rule)
//   - <cite> tags from Anthropic web_search citations
//   - Personnel/artist/producer/studio/gear names (Suno swaps these for genre centroids)
//
// Locked 2026-04-25 after first Suno reality check.

const BPM_RE = /(?:\bat\s+)?\b\d{2,3}\s*-?\s*bpm\b/gi
const KEY_RE = /\b(?:in\s+(?:the\s+key\s+of\s+)?)?(?:[A-G](?:[#b])?)\s+(?:major|minor|maj|min)(?:\s+key)?\b/gi
const STANDALONE_MODE_RE = /\b(?:major|minor)\s+key\b/gi

// Anthropic's web_search tool can emit <cite index="..."> ... </cite>. Strip.
const CITE_OPEN_RE = /<cite\b[^>]*>/gi
const CITE_CLOSE_RE = /<\/cite>/gi

// Personnel / artist / producer / studio / gear name stripping.
// rules-v4 forbids these in any field, but as belt-and-suspenders we strip a
// curated list at the Mars layer too. The list is intentionally short — the
// real defense is the LLM rule. This catches the common leakage cases.
const NAME_PATTERNS: RegExp[] = [
  // Common Sympathy-for-the-Devil personnel that leak through testing
  /\bMick\s+Jagger\b/gi,
  /\bKeith\s+Richards\b/gi,
  /\bCharlie\s+Watts\b/gi,
  /\bBill\s+Wyman\b/gi,
  /\bBrian\s+Jones\b/gi,
  /\bNicky\s+Hopkins\b/gi,
  /\bRocky\s+Dijon\b/gi,
  /\bMarianne\s+Faithfull\b/gi,
  /\bAnita\s+Pallenberg\b/gi,
  /\bJimmy\s+Miller\b/gi,
  /\bGlyn\s+Johns\b/gi,
  /\bMichael\s+Cooper\b/gi,
  /\bDamon\s+Albarn\b/gi,
  /\bGorillaz\b/gi,
  /\bRolling\s+Stones?\b/gi,
  /\bThe\s+Stones\b/gi,
  /\bKanye\s+(?:West)?\b/gi,
  /\bDwele\b/gi,
  /\bConnie\s+Mitchell\b/gi,
  /\bEric\s+Hudson\b/gi,
  /\bLarry\s+Gold\b/gi,
  /\bChen\s+Wei[- ]Man\b/gi,
  /\bZeng\s+Zhen\b/gi,
  // Studios
  /\bOlympic\s+(?:Sound\s+)?Studios?\b/gi,
  /\bSunset\s+Sound\b/gi,
  /\bAbbey\s+Road\b/gi,
  // Gear brands
  /\bGibson\s+(?:Les\s+Paul(?:\s+Black\s+Beauty)?|SG)\b/gi,
  /\bFender\s+(?:Precision|Jazz|Stratocaster|Telecaster|Rhodes)\b/gi,
  /\bHammond\s+B\d?\b/gi,
  /\bMoog\s+(?:Minimoog|Voyager|Sub\s+\d+)?\b/gi,
  /\bRoland\s+(?:Fantom|Juno|Jupiter|TR-?\d+|TB-?\d+)\b/gi,
  /\bMPC\s*(?:60|2000|3000|4000)?\b/gi,
  /\bPro\s+Tools\b/gi,
  /\bAuto-?Tune\b/gi,
  // Other common producer/artist names that may leak across tracks
  /\bDr\.?\s*Dre\b/gi,
  /\bRick\s+Rubin\b/gi,
  /\bGeorge\s+Martin\b/gi,
]

/** Normalize whitespace, collapse comma artifacts, strip trailing punctuation. */
function tidy(s: string): string {
  return s
    .replace(/\s*,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .replace(/[\s,.]+$/g, '') // strip trailing comma/period/space so join doesn't double up
    .trim()
}

/** Strip tempo, mode, key, cite tags. (Public — also used by Card 5 sanitizer compat.) */
export function stripTempoAndKey(text: string | null | undefined): string {
  if (!text) return ''
  let s = text
  s = s.replace(CITE_OPEN_RE, '')
  s = s.replace(CITE_CLOSE_RE, '')
  s = s.replace(BPM_RE, '')
  s = s.replace(KEY_RE, '')
  s = s.replace(STANDALONE_MODE_RE, '')
  return tidy(s)
}

/** Full Suno-bound sanitization: tempo/key/cite tags + personnel/gear/studio names. */
export function stripForSuno(text: string | null | undefined): string {
  if (!text) return ''
  let s = stripTempoAndKey(text)
  for (const re of NAME_PATTERNS) s = s.replace(re, '')
  return tidy(s)
}
