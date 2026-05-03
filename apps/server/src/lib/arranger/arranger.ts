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
  // v8+: section-level energy character. Emitted as [<dynamic>, <density>] line.
  dynamic?: 'steady' | 'building' | 'dropping' | 'stripped' | 'erupting' | 'fade' | 'sustained' | 'retreating'
  // v8+: section-level vocal staging. Emitted as [<delivery>] line.
  vocal_delivery?: 'close-mic' | 'distant' | 'whispered' | 'belted' | 'falsetto' | 'stacked' | 'doubled' | 'wordless' | 'instrumental' | 'a-cappella'
}

export type ArrangementSections = Partial<Record<SectionKey, SectionDirective>>

type SectionKey = 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'outro'

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

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildSectionTags(directive: SectionDirective): string[] {
  const tags: string[] = []
  const instruments = directive.instruments.slice(0, 3)
  if (instruments.length > 0) {
    tags.push(`[Instrument: ${instruments.join(', ')}]`)
  }
  if (directive.dynamic) {
    const dynamicTag = directive.density
      ? `[${titleCase(directive.dynamic)}, ${directive.density}]`
      : `[${titleCase(directive.dynamic)}]`
    tags.push(dynamicTag)
  }
  if (directive.vocal_delivery) {
    tags.push(`[${titleCase(directive.vocal_delivery)}]`)
  }
  return tags
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
      if (!directive) return [line]

      const tags = buildSectionTags(directive)
      return [line, ...tags]
    })
    .join('\n')
}
