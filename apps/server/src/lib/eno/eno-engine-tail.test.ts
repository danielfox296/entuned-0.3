import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock only the engine-specific DB/LLM dependencies of the two tails. The pure
// modules (buildFlowTimeline, assembleFlowPrompt, injectArrangement) run for real
// so we test the actual assembled output.
vi.mock('../../db.js', () => ({
  prisma: { outcomeFactorPrompt: { findFirst: vi.fn(), create: vi.fn() } },
}))

const runFlowRenderer = vi.fn()
vi.mock('../flow/renderer.js', () => ({ runFlowRenderer: (...a: any[]) => runFlowRenderer(...a) }))

const getOrSeedFlowTimelinePolicy = vi.fn()
const loadCounterExclusionsForAnchor = vi.fn()
vi.mock('../flow/loaders.js', () => ({
  getOrSeedFlowTimelinePolicy: (...a: any[]) => getOrSeedFlowTimelinePolicy(...a),
  loadCounterExclusionsForAnchor: (...a: any[]) => loadCounterExclusionsForAnchor(...a),
}))

const runMusicProfessor = vi.fn()
vi.mock('../music-professor/music-professor.js', () => ({ runMusicProfessor: (...a: any[]) => runMusicProfessor(...a) }))

const getOrSeedArrangementPolicy = vi.fn()
vi.mock('../arranger/policy.js', () => ({ getOrSeedArrangementPolicy: (...a: any[]) => getOrSeedArrangementPolicy(...a) }))

import { renderFlowTail, renderSunoTail } from './eno.js'
import { FLOW_TIMELINE_POLICY_SEED } from '../flow/timeline.js'
import { ARRANGEMENT_POLICY_SEED } from '../arranger/arranger.js'
import { prisma } from '../../db.js'
import type { MarsOutput } from '../mars/mars.js'

const ofpFindFirst = prisma.outcomeFactorPrompt.findFirst as ReturnType<typeof vi.fn>

const MARS: MarsOutput = {
  style: '1970s soul, breathy lead, I-IV vamp',
  negativeStyle: 'smooth jazz, adult contemporary, autotune',
  vocalGender: 'male',
  firedExclusionRuleIds: ['rule-1'],
  styleTemplateVersion: 2,
  anchor: { tag: '1970s soul', corrections: [], negativeAdditions: [] },
  harmonicPalette: 'I-IV vamp',
  vocalIdentity: 'dark vocal, behind-the-beat delivery, warm recording',
  vocalDescriptor: null,
}

const STYLE_ANALYSIS = {
  genreAnchor: '1970s soul',
  eraProductionSignature: 'early-70s analog warmth',
  instrumentationPalette: 'rhodes, upright bass, brushed drums',
  harmonicCharacter: 'loose diatonic vamps',
  grooveCharacter: 'behind-the-beat',
  vocalCharacter: 'smoky baritone',
  vocalRegister: 'baritone',
} as any

const LYRICS = `[Verse 1]
I set the table for two every night

[Chorus]
walking away from the ghost of you

[Verse 2]
came back late

[Chorus]
walking away and I won't look back`

const RESOLVED = { tempoBpm: 94, mode: 'minor' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('renderFlowTail', () => {
  beforeEach(() => {
    getOrSeedFlowTimelinePolicy.mockResolvedValue({ version: 7, config: FLOW_TIMELINE_POLICY_SEED })
    loadCounterExclusionsForAnchor.mockResolvedValue(['adult contemporary radio'])
    runFlowRenderer.mockResolvedValue({ soundWorld: 'A rich soul sound-world.', sectionDescriptions: {}, personaVersion: 5, fellBack: false })
  })

  it('returns flow-shaped output: prose style, null negativeStyle, timeline lyrics', async () => {
    const out = await renderFlowTail({ styleAnalysis: STYLE_ANALYSIS, mars: MARS, resolved: RESOLVED, mood: 'energetic', professorLyrics: LYRICS, arrangementSections: null })

    expect(out.style).toBe('A rich soul sound-world.')
    expect(out.negativeStyle).toBeNull()
    expect(out.lyrics).toContain('[00:00]')
    expect(out.lyrics).toContain('I set the table for two every night')
    expect(out.provenance.flowRendererPersonaVersion).toBe(5)
    expect(out.provenance.flowTimelinePolicyVersion).toBe(7)
  })

  it('feeds Mars negativeStyle + genre-gravity counter-exclusions as avoid terms', async () => {
    await renderFlowTail({ styleAnalysis: STYLE_ANALYSIS, mars: MARS, resolved: RESOLVED, mood: 'energetic', professorLyrics: LYRICS, arrangementSections: null })

    expect(loadCounterExclusionsForAnchor).toHaveBeenCalledWith('1970s soul')
    const input = runFlowRenderer.mock.calls[0][0]
    expect(input.avoidTerms).toEqual(expect.arrayContaining(['smooth jazz', 'adult contemporary', 'autotune', 'adult contemporary radio']))
    expect(input.outcome).toEqual({ mood: 'energetic', tempoBpm: 94, mode: 'minor' })
    expect(input.decomposition.genreAnchor).toBe('1970s soul')
    expect(input.decomposition.instrumentationPalette).toBe('rhodes, upright bass, brushed drums')
  })

  it('NEVER calls the Music Professor on the Flow path', async () => {
    await renderFlowTail({ styleAnalysis: STYLE_ANALYSIS, mars: MARS, resolved: RESOLVED, mood: 'energetic', professorLyrics: LYRICS, arrangementSections: null })
    expect(runMusicProfessor).not.toHaveBeenCalled()
  })

  it('uses a deterministic fallback sound-world when the renderer fell back', async () => {
    runFlowRenderer.mockResolvedValue({ soundWorld: '', sectionDescriptions: {}, personaVersion: 5, fellBack: true })

    const out = await renderFlowTail({ styleAnalysis: STYLE_ANALYSIS, mars: MARS, resolved: RESOLVED, mood: 'energetic', professorLyrics: LYRICS, arrangementSections: null })

    expect(out.style).toBe('A energetic 1970s soul at 94 BPM in a minor key.')
    // lyrics still well-formed with verbatim hooks
    expect(out.lyrics).toContain("walking away and I won't look back")
  })
})

describe('renderSunoTail', () => {
  beforeEach(() => {
    ofpFindFirst.mockResolvedValue({ version: 3, templateText: '{mood}, {tempo_bpm}bpm, {mode}' })
    getOrSeedArrangementPolicy.mockResolvedValue({ version: 1, config: ARRANGEMENT_POLICY_SEED })
    runMusicProfessor.mockResolvedValue({ style: '1970s soul, polished', negativeStyle: 'smooth jazz', personaVersion: 4, changeLog: ['era'], fellBack: false })
  })

  it('returns suno-shaped output: prepended style, MP negativeStyle, bracket-tag lyrics', async () => {
    const out = await renderSunoTail({ mars: MARS, resolved: RESOLVED, mood: 'energetic', professorLyrics: LYRICS, arrangementSections: null, arrangementVersion: null })

    expect(out.style.startsWith('energetic, 94bpm, minor')).toBe(true)
    expect(out.style).toContain('dark vocal, behind-the-beat delivery, warm recording')
    expect(out.style).toContain('1970s soul, polished')
    expect(out.negativeStyle).toBe('smooth jazz')
    expect(out.lyrics).toContain('Final Chorus') // injectArrangement ran
    expect(out.provenance.musicProfessorPersonaVersion).toBe(4)
    expect(out.provenance.outcomeFactorPromptVersion).toBe(3)
    expect(out.provenance.flowRendererPersonaVersion).toBeUndefined()
  })

  it('NEVER calls the Flow renderer on the Suno path', async () => {
    await renderSunoTail({ mars: MARS, resolved: RESOLVED, mood: 'energetic', professorLyrics: LYRICS, arrangementSections: null, arrangementVersion: null })
    expect(runFlowRenderer).not.toHaveBeenCalled()
  })
})
