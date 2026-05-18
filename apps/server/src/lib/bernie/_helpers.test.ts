import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma BEFORE importing the helpers module so the import binding
// resolves to our mock.
vi.mock('../../db.js', () => ({
  prisma: {
    lyricDraftPrompt: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { formatArrangementBrief, getOrSeedDraftPrompt, parseLyricJson } from './_helpers.js'
import { prisma } from '../../db.js'
import { DRAFT_PROMPT_SEED } from '../proto-bernie/lyrics.js'
import type { ArrangementSections } from '../arranger/arranger.js'

describe('formatArrangementBrief', () => {
  it('returns empty string when sections object is empty', () => {
    expect(formatArrangementBrief({})).toBe('')
  })

  it('returns empty string when every section has empty instruments array', () => {
    const sections: ArrangementSections = {
      intro: { instruments: [] },
      verse: { instruments: [] },
      chorus: { instruments: [] },
    }
    expect(formatArrangementBrief(sections)).toBe('')
  })

  it('renders sections in SECTION_ORDER even if input order differs', () => {
    const sections: ArrangementSections = {
      outro: { instruments: ['piano'] },
      chorus: { instruments: ['drums'] },
      intro: { instruments: ['pad'] },
      verse: { instruments: ['bass'] },
    }
    const out = formatArrangementBrief(sections)
    const introIdx = out.indexOf('- intro:')
    const verseIdx = out.indexOf('- verse:')
    const chorusIdx = out.indexOf('- chorus:')
    const outroIdx = out.indexOf('- outro:')
    expect(introIdx).toBeGreaterThan(-1)
    expect(verseIdx).toBeGreaterThan(introIdx)
    expect(chorusIdx).toBeGreaterThan(verseIdx)
    expect(outroIdx).toBeGreaterThan(chorusIdx)
  })

  it('renders pre_chorus with display label "pre-chorus"', () => {
    const sections: ArrangementSections = {
      pre_chorus: { instruments: ['synth'] },
    }
    const out = formatArrangementBrief(sections)
    expect(out).toContain('- pre-chorus:')
    expect(out).not.toContain('pre_chorus')
  })

  it('slices to first 3 instruments per section', () => {
    const sections: ArrangementSections = {
      verse: { instruments: ['guitar', 'bass', 'drums', 'piano', 'strings'] },
    }
    const out = formatArrangementBrief(sections)
    expect(out).toContain('guitar, bass, drums')
    expect(out).not.toContain('piano')
    expect(out).not.toContain('strings')
  })

  it('defaults density to "medium" when not provided', () => {
    const sections: ArrangementSections = {
      verse: { instruments: ['guitar'] },
    }
    const out = formatArrangementBrief(sections)
    expect(out).toContain('- verse: medium')
  })

  it('includes dynamic extras when present (parenthesized)', () => {
    const sections: ArrangementSections = {
      chorus: { instruments: ['drums'], dynamic: 'building' },
    }
    const out = formatArrangementBrief(sections)
    expect(out).toContain('(building)')
  })

  it('includes vocal_delivery extras when present', () => {
    const sections: ArrangementSections = {
      chorus: { instruments: ['drums'], vocal_delivery: 'belted' },
    }
    const out = formatArrangementBrief(sections)
    expect(out).toContain('(belted)')
  })

  it('combines dynamic and vocal_delivery in extras', () => {
    const sections: ArrangementSections = {
      chorus: { instruments: ['drums'], dynamic: 'building', vocal_delivery: 'belted' },
    }
    const out = formatArrangementBrief(sections)
    expect(out).toContain('(building, belted)')
  })

  it('skips sections not in SECTION_ORDER', () => {
    const sections = {
      verse: { instruments: ['bass'] },
      // @ts-expect-error - intentional extra key not in SECTION_ORDER
      breakdown: { instruments: ['synth'] },
    } as ArrangementSections
    const out = formatArrangementBrief(sections)
    expect(out).toContain('- verse:')
    expect(out).not.toContain('breakdown')
    expect(out).not.toContain('synth')
  })

  it('uses provided density when set (overrides default)', () => {
    const sections: ArrangementSections = {
      intro: { instruments: ['pad'], density: 'sparse' },
    }
    const out = formatArrangementBrief(sections)
    expect(out).toContain('- intro: sparse')
  })
})

describe('parseLyricJson', () => {
  it('parses clean JSON', () => {
    const result = parseLyricJson('{"title": "T", "lyrics": "L"}')
    expect(result).toEqual({ title: 'T', lyrics: 'L' })
  })

  it('strips ```json opening fence and ``` closing fence', () => {
    const text = '```json\n{"title": "T", "lyrics": "L"}\n```'
    expect(parseLyricJson(text)).toEqual({ title: 'T', lyrics: 'L' })
  })

  it('strips bare ``` fences (no language tag)', () => {
    const text = '```\n{"title": "T", "lyrics": "L"}\n```'
    expect(parseLyricJson(text)).toEqual({ title: 'T', lyrics: 'L' })
  })

  it('finds JSON object even with prefix text before {', () => {
    const text = 'Here is your output:\n{"title": "T", "lyrics": "L"}'
    expect(parseLyricJson(text)).toEqual({ title: 'T', lyrics: 'L' })
  })

  it('throws on missing title', () => {
    expect(() => parseLyricJson('{"lyrics": "L"}')).toThrow(/missing title or lyrics/)
  })

  it('throws on missing lyrics', () => {
    expect(() => parseLyricJson('{"title": "T"}')).toThrow(/missing title or lyrics/)
  })

  it('throws when no { present at all', () => {
    expect(() => parseLyricJson('no json here')).toThrow(/No JSON in lyricist output/)
  })

  it('throws on completely unparseable JSON', () => {
    expect(() => parseLyricJson('{this is not valid json')).toThrow()
  })
})

describe('getOrSeedDraftPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns existing row without calling create', async () => {
    ;(prisma.lyricDraftPrompt.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 4,
      promptText: 'existing prompt text',
    })

    const result = await getOrSeedDraftPrompt()

    expect(result).toEqual({ version: 4, promptText: 'existing prompt text' })
    expect(prisma.lyricDraftPrompt.findFirst).toHaveBeenCalledWith({ orderBy: { version: 'desc' } })
    expect(prisma.lyricDraftPrompt.create).not.toHaveBeenCalled()
  })

  it('seeds v1 with DRAFT_PROMPT_SEED when findFirst returns null', async () => {
    ;(prisma.lyricDraftPrompt.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prisma.lyricDraftPrompt.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 1,
      promptText: DRAFT_PROMPT_SEED,
      notes: 'Auto-seeded v1',
    })

    const result = await getOrSeedDraftPrompt()

    expect(prisma.lyricDraftPrompt.create).toHaveBeenCalledWith({
      data: { version: 1, promptText: DRAFT_PROMPT_SEED, notes: 'Auto-seeded v1' },
    })
    expect(result).toEqual({ version: 1, promptText: DRAFT_PROMPT_SEED })
  })
})
