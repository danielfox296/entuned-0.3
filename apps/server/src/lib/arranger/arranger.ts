// Arranger — post-processes Bernie's lyrics to inject per-section instrument tags.
//
// Suno reads [Instrument: X, Y] immediately after a [Section] header as a signal
// to bias toward those instruments for that section. These are hints, not commands —
// Suno can drift, and tag overload reduces reliability. Max 3 instruments per section.
//
// This is a pure function: no DB access, no LLM. Called in createSongSeed() after
// Bernie returns, before writing SongSeed.lyrics.

export interface SectionDirective {
  instruments: string[]
  density?: 'minimal' | 'sparse' | 'medium' | 'full'
}

export type ArrangementSections = Partial<Record<SectionKey, SectionDirective>>

type SectionKey = 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'outro'

// Maps raw [Section] header text → normalized key. Case-insensitive prefix match.
const SECTION_MAP: Array<[RegExp, SectionKey]> = [
  [/^intro/i, 'intro'],
  [/^pre[\s-]?chorus/i, 'pre_chorus'],
  [/^chorus/i, 'chorus'],
  [/^verse/i, 'verse'],
  [/^bridge/i, 'bridge'],
  [/^outro/i, 'outro'],
]

function normalizeSection(headerContent: string): SectionKey | null {
  for (const [re, key] of SECTION_MAP) {
    if (re.test(headerContent.trim())) return key
  }
  return null
}

function buildInstrumentTag(directive: SectionDirective): string {
  const instruments = directive.instruments.slice(0, 3) // hard cap per Suno reliability notes
  if (instruments.length === 0) return ''
  return `[Instrument: ${instruments.join(', ')}]`
}

export function injectArrangement(lyrics: string, sections: ArrangementSections): string {
  if (Object.keys(sections).length === 0) return lyrics

  return lyrics
    .split('\n')
    .flatMap((line) => {
      const headerMatch = line.match(/^\[([^\]]+)\]$/)
      if (!headerMatch) return [line]

      const key = normalizeSection(headerMatch[1])
      if (!key) return [line]

      const directive = sections[key]
      if (!directive || directive.instruments.length === 0) return [line]

      const tag = buildInstrumentTag(directive)
      return tag ? [line, tag] : [line]
    })
    .join('\n')
}
