// Flow Renderer — the LLM that composes the Google Lyria (Flow) sound-world prose
// and per-slot production descriptions from a reference track's FULL decomposition.
//
// This is the Flow counterpart to the Music Professor, and mirrors its shape:
// a single Anthropic call, a versioned DB-backed persona, additive, and it MUST
// NEVER block a seed — on any failure it falls back to empty output and the
// assembler still produces a valid prompt from the deterministic timeline alone.
//
// Hook integrity by construction: the renderer is given the timeline's section
// ROLES and instrumentation hints but NOT the lyric lines. Its tool returns only
// soundWorld prose + descriptions keyed by slot index. It cannot corrupt a hook
// line because it never receives or emits one — the timeline builder owns the
// verbatim lyrics.

import Anthropic from '@anthropic-ai/sdk'
import { getOrSeedFlowRendererPersona } from './loaders.js'
import type { FlowTimeline } from './timeline.js'

const MODEL = process.env.FLOW_RENDERER_MODEL ?? process.env.MUSIC_PROFESSOR_MODEL ?? 'claude-sonnet-4-6'

// Generous guardrails — Flow has no prompt cap, but bound runaway output.
const SOUND_WORLD_HARD_CAP = 2500
const DESCRIPTION_HARD_CAP = 400

/** The decomposition fields the renderer reads. A plain object (not the Prisma
 *  row) so it's trivially testable; eno maps a normalized StyleAnalysis into it. */
export interface FlowRendererDecomposition {
  genreAnchor?: string | null
  eraProductionSignature?: string | null
  instrumentationPalette?: string | null
  harmonicCharacter?: string | null
  harmonicAndGroove?: string | null
  grooveCharacter?: string | null
  standoutElement?: string | null
  vibePitch?: string | null
  vocalCharacter?: string | null
  vocalArrangement?: string | null
  vocalRegister?: string | null
}

export interface FlowRendererInput {
  decomposition: FlowRendererDecomposition
  /** Mars's chosen genre anchor (most genre-accurate signal). */
  anchorTag: string | null
  /** Composed triple-stack vocal identity, when Mars produced one. */
  vocalIdentity: string | null
  /** Legacy single vocal descriptor fallback. */
  vocalDescriptor: string | null
  /** Harmonic palette token Mars injected, when a GenreGravityRule matched. */
  harmonicPalette: string | null
  /** male | female | duet | instrumental | null. */
  vocalGender: string | null
  /** Terms to steer AWAY from — Mars negativeStyle + matched counterExclusions.
   *  The renderer rephrases these positively; it never lists them. */
  avoidTerms: string[]
  /** Affect anchor — must surface in the sound-world prose. */
  outcome: { mood: string; tempoBpm: number; mode: string }
  /** The pre-built timeline. Lyrics are NOT sent to the model — only roles/hints. */
  timeline: FlowTimeline
}

export interface FlowRendererOutput {
  soundWorld: string
  /** Production description per timeline slot index. Missing indices render with
   *  no description (the assembler degrades to a bare timestamp). */
  sectionDescriptions: Record<number, string>
  personaVersion: number
  fellBack: boolean
  fallbackReason?: 'tool_refusal' | 'empty_sound_world' | 'api_error'
}

const EMIT_FLOW_PROMPT_TOOL: Anthropic.Tool = {
  name: 'emit_flow_prompt',
  description: 'Emit the Flow sound-world prose and one production description per timeline slot.',
  input_schema: {
    type: 'object',
    properties: {
      soundWorld: {
        type: 'string',
        description: 'One rich paragraph (4–7 sentences) describing the overall sound, anchored by the outcome mood + tempo. Natural language, not tags. No lyrics.',
      },
      sections: {
        type: 'array',
        description: 'One entry per timeline slot, addressed by index. Production description only — never lyrics.',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'The timeline slot index this describes.' },
            description: { type: 'string', description: '1–2 sentences on what happens sonically in this slot. No lyrics.' },
          },
          required: ['index', 'description'],
        },
      },
    },
    required: ['soundWorld', 'sections'],
  },
}

function formatDecomposition(d: FlowRendererDecomposition): string {
  const rows: Array<[string, string | null | undefined]> = [
    ['Genre anchor', d.genreAnchor],
    ['Era & production', d.eraProductionSignature],
    ['Instrumentation', d.instrumentationPalette],
    ['Harmonic character', d.harmonicCharacter ?? d.harmonicAndGroove],
    ['Groove', d.grooveCharacter],
    ['Standout element', d.standoutElement],
    ['Overall vibe', d.vibePitch],
    ['Vocal character', d.vocalCharacter],
    ['Vocal arrangement', d.vocalArrangement],
    ['Vocal register', d.vocalRegister],
  ]
  return rows
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `- ${k}: ${v!.trim()}`)
    .join('\n')
}

function formatTimelineForPrompt(timeline: FlowTimeline): string {
  return timeline.slots
    .map((s) => {
      const role = s.kind === 'instrumental' ? `${s.label} (instrumental — no voice)` : s.label
      const final = s.chorusRank?.isFinal ? ' [FINAL — peak energy]' : ''
      const instruments = s.directive?.instruments?.length ? ` — instruments: ${s.directive.instruments.join(', ')}` : ''
      const density = s.directive?.density ? `; density ${s.directive.density}` : ''
      return `${s.index}. ${role}${final}${instruments}${density}`
    })
    .join('\n')
}

export async function runFlowRenderer(input: FlowRendererInput): Promise<FlowRendererOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ apiKey })

  const persona = await getOrSeedFlowRendererPersona()

  const vocal = input.vocalIdentity || input.vocalDescriptor || null
  const avoid = input.avoidTerms.filter((t) => t && t.trim())

  const userMessage = `Compose the Flow prompt for this track.

Outcome affect (anchor the sound-world in this): mood "${input.outcome.mood}", ${input.outcome.tempoBpm} BPM, ${input.outcome.mode} key.

Decomposition of the reference track:
${formatDecomposition(input.decomposition) || '- (sparse decomposition — lean on the anchor)'}
${input.anchorTag ? `- Genre anchor (authoritative): ${input.anchorTag}` : ''}
${vocal ? `- Vocal identity: ${vocal}` : ''}
${input.vocalGender ? `- Vocal gender: ${input.vocalGender}` : ''}
${input.harmonicPalette ? `- Harmonic palette: ${input.harmonicPalette}` : ''}
${avoid.length ? `\nSteer the sound AWAY from these (render the opposite POSITIVELY, never list them): ${avoid.join(', ')}` : ''}

Timeline slots (describe each by index — production only, NEVER lyrics):
${formatTimelineForPrompt(input.timeline)}

Emit soundWorld + one description per slot via the tool.`

  let toolInput: { soundWorld?: string; sections?: Array<{ index?: number; description?: string }> } | null = null
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: persona.promptText, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      tools: [EMIT_FLOW_PROMPT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_flow_prompt' },
    })
    const toolUse = response.content.find((b: any) => b.type === 'tool_use' && (b as any).name === 'emit_flow_prompt') as any
    if (toolUse) toolInput = toolUse.input
  } catch {
    return { soundWorld: '', sectionDescriptions: {}, personaVersion: persona.version, fellBack: true, fallbackReason: 'api_error' }
  }

  if (!toolInput) {
    return { soundWorld: '', sectionDescriptions: {}, personaVersion: persona.version, fellBack: true, fallbackReason: 'tool_refusal' }
  }
  const soundWorld = typeof toolInput.soundWorld === 'string' ? toolInput.soundWorld.trim() : ''
  if (soundWorld.length === 0) {
    return { soundWorld: '', sectionDescriptions: {}, personaVersion: persona.version, fellBack: true, fallbackReason: 'empty_sound_world' }
  }

  const sectionDescriptions: Record<number, string> = {}
  if (Array.isArray(toolInput.sections)) {
    for (const s of toolInput.sections) {
      if (typeof s?.index !== 'number') continue
      const desc = typeof s.description === 'string' ? s.description.trim() : ''
      if (!desc) continue
      sectionDescriptions[s.index] = desc.slice(0, DESCRIPTION_HARD_CAP)
    }
  }

  return {
    soundWorld: soundWorld.slice(0, SOUND_WORLD_HARD_CAP),
    sectionDescriptions,
    personaVersion: persona.version,
    fellBack: false,
  }
}
