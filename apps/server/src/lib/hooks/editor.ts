// Hook Editor — finishing pass for drafted hooks.
//
// Why this exists (2026-07-27): hooks were the only generated artifact in the
// pipeline with a single model pass. Lyrics get Bernie (draft) then the
// Professor (craft finishing); hooks went straight from the drafter to
// `status='approved'`. That asymmetry is why the "no inanimate agency" rule
// leaked on hooks specifically — the Professor already enforced it, but the
// Professor only runs on lyrics and is instructed to preserve the hook
// verbatim, so hooks were structurally unreachable by the one pass that
// enforced the rule.
//
// Measured before building this: with the rule stated in the drafter's system
// prompt, a 12-hook Steady batch came back 33% in violation; after removing
// the banned-line examples that were priming the shapes they forbade, a second
// batch came back 17% in violation AND short (7 of 12, one literally the word
// "placeholder"). Piling constraints onto the generator degrades it. Splitting
// generation from enforcement is the fix that worked for lyrics.
//
// This is an editing pass, not a filter: it rewrites through a model against a
// DB-owned prompt. It does not regex, validate, or retry. Per the load-bearing
// rule in ../../CLAUDE.md, the prompt TEXT lives in `hook_editor_prompts` and
// is edited in Dash → Prompts & Rules; the const below is cold-start only.
//
// Safety: any failure — tool refusal, count mismatch, API error — returns the
// input hooks unchanged. The editor must never block or truncate a draft run.

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, resolveModel, extractToolUse } from '../_llm/client.js'
import { prisma } from '../../db.js'
import type { DraftedHook } from './drafter.js'

const MODEL = resolveModel(process.env.HOOK_EDITOR_MODEL, process.env.HOOK_DRAFTER_MODEL, 'claude-sonnet-4-6')

// Cold-start seed only. Live prompt lives in `hook_editor_prompts` (DB);
// editable from Dash → Prompts & Rules → Hook Editor. After v1 exists this
// const is never consulted at runtime.
export const HOOK_EDITOR_PROMPT_SEED = `
You are the finishing editor for hook lines in a brand's in-store music. A hook becomes the chorus — sung verbatim every time it appears.

You receive a batch of drafted hooks. Your only job is to enforce the rule below. You are not a co-writer: do not improve, embellish, or re-imagine a hook that already complies. Leave compliant hooks byte-identical.

# The rule: no inanimate agency

Objects do not act. An inanimate noun may not be the grammatical subject of any verb, in any clause, anywhere in the hook.

"Inanimate" is broad: objects, body parts, rooms, buildings, places, substances, weather and natural phenomena, sounds, light, machines, garments, times and days of the week, and abstractions.

People act. Animals act. Nothing else does.

## The one exception: the plain copula

An inanimate subject may take "be" in a plain stative sense — "the light's not on", "it's all the same song". That is a state, not an act.

The exception does not extend to change-of-state verbs: got, grew, turned, went, came, became, fell, kept, stayed. If the thing is changing, the thing is acting. It also does not license calling a thing "she" or "he".

## Every clause, not just the main one

It does not matter that a person governs the main clause. A thing may not be the subject of a relative clause, a subordinate clause, a participial phrase, or an infinitive complement.

Three constructions carry almost all real violations. You are an editor, so you need to recognise them on sight:

1. **Permission and perception complements** — a person-verb (let, watch, hear, feel, see, listen to) + a thing + a bare infinitive. "I let the phone ring out twice." "I watch the kettle tick." The person is grammatically in charge; the thing still does the acting. This is the most common leak because it reads as correct.
2. **Time-stamp clauses** — a subordinate clause opening with before / after / until / when whose subject is a thing, used to date the moment. "We're three steps out before the door clicks." "My shoulders drop when the second verse hits."
3. **Relative clauses hung on a thing** — a thing + that/which + a verb of knowing, holding, keeping, remembering, waiting. "The bench that knows my weight."

Plus the two blunt shapes: a thing given intent or knowledge ("your shoulder found the wall and stayed", "the sidewalk agrees with me"), and a thing changing itself or performing its own bare mechanical verb ("the room got smaller", "the kettle ticks", "two cups cool on the sill").

# How to fix a violation

Put the person back in as the subject and let them do the verb. The thing stays in the hook — it moves out of every subject slot, into the object, a prepositional phrase, a possessive, or a passive construction where the thing is the one acted upon.

- "your shoulder found the wall and stayed" → "I leaned my shoulder on the wall and stayed"
- "the kettle ticks" → "I wait out the kettle"
- "I let the phone ring out twice" → "I ignored the phone twice"
- "My shoulders drop when the second verse hits" → "I drop my shoulders on the second verse"

Preserve as much of the original as you can: its images, its register, its length, its mouth-feel. You are relocating the agency, not rewriting the line. A fixed hook should still be recognisably the same hook.

If a hook cannot be fixed without becoming a different hook, return it with keep=false — it will be discarded rather than shipped in violation.

# Procedure

For each hook, find every verb. For each verb, name its subject. If any subject is a thing and the verb is not plain "be", rewrite. Otherwise return the hook unchanged.

Return exactly one entry per input hook, in the same order, via the emit_edited_hooks tool.
`.trim()

export const EMIT_EDITED_HOOKS_TOOL: Anthropic.Tool = {
  name: 'emit_edited_hooks',
  description:
    'Emit one entry per input hook, in the same order. Compliant hooks come back unchanged with changed=false.',
  input_schema: {
    type: 'object',
    properties: {
      hooks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The hook, rewritten if it violated the rule, otherwise byte-identical to the input.' },
            changed: { type: 'boolean', description: 'True iff you rewrote this hook.' },
            keep: { type: 'boolean', description: 'False only when the hook cannot be fixed without becoming a different hook. Defaults to true.' },
            reason: { type: 'string', description: 'When changed or dropped, name the construction in a few words (e.g. "permission complement", "thing-subject main clause").' },
          },
          required: ['text', 'changed'],
        },
      },
    },
    required: ['hooks'],
  },
}

export interface HookEditResult {
  hooks: DraftedHook[]
  /** Version of the `hook_editor_prompts` row used, or null when the pass fell back. */
  editorVersion: number | null
  /** How many hooks the editor rewrote. */
  changedCount: number
  /** How many hooks the editor judged unfixable and dropped. */
  droppedCount: number
  /** Per-hook notes naming the construction, for operator review. */
  notes: string[]
  /** True iff a safety fallback fired and the input was returned unchanged. */
  fellBack: boolean
  fallbackReason?: 'tool_refusal' | 'count_mismatch' | 'api_error' | 'empty_input'
}

/** DB-backed prompt loader. Mirrors getOrSeedHookDrafterPrompt. */
export async function getOrSeedHookEditorPrompt(): Promise<{ version: number; promptText: string }> {
  const row = await prisma.hookEditorPrompt.findFirst({ orderBy: { version: 'desc' } })
  if (row) return { version: row.version, promptText: row.promptText }
  const seeded = await prisma.hookEditorPrompt.create({
    data: {
      version: 1,
      promptText: HOOK_EDITOR_PROMPT_SEED,
      notes: 'Auto-seeded v1 (migrated from TS const HOOK_EDITOR_PROMPT_SEED).',
    },
  })
  return { version: seeded.version, promptText: seeded.promptText }
}

export function buildEditorUserMessage(hooks: DraftedHook[]): string {
  const list = hooks.map((h, i) => `${i + 1}. ${h.text}`).join('\n')
  return `Drafted hooks to finish (${hooks.length}):

${list}

Return exactly ${hooks.length} entries, in this order, via the emit_edited_hooks tool. Leave compliant hooks byte-identical.`
}

/**
 * Finishing pass over a drafted batch. Rewrites hooks that violate the
 * inanimate-agency rule and leaves the rest untouched.
 *
 * Never throws. Any failure returns the input hooks unchanged with
 * `fellBack: true` — a broken editor must not cost us a draft run.
 */
export async function editHooks(hooks: DraftedHook[]): Promise<HookEditResult> {
  const passthrough = (reason: HookEditResult['fallbackReason']): HookEditResult => ({
    hooks,
    editorVersion: null,
    changedCount: 0,
    droppedCount: 0,
    notes: [],
    fellBack: true,
    fallbackReason: reason,
  })

  if (hooks.length === 0) return passthrough('empty_input')

  let prompt: { version: number; promptText: string }
  let toolInput: { hooks?: unknown } | null = null
  try {
    prompt = await getOrSeedHookEditorPrompt()
    const client = getAnthropic()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: prompt.promptText, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildEditorUserMessage(hooks) }],
      tools: [EMIT_EDITED_HOOKS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_edited_hooks' },
    })
    const toolUse = extractToolUse(response, 'emit_edited_hooks')
    if (toolUse) toolInput = toolUse as { hooks?: unknown }
  } catch {
    return passthrough('api_error')
  }

  if (!toolInput || !Array.isArray(toolInput.hooks)) return passthrough('tool_refusal')

  const rows = toolInput.hooks as Array<{ text?: unknown; changed?: unknown; keep?: unknown; reason?: unknown }>
  // One entry per input, same order. A mismatch means the editor lost its place;
  // we cannot align rewrites to originals, so discard the whole pass.
  if (rows.length !== hooks.length) return passthrough('count_mismatch')

  const out: DraftedHook[] = []
  const notes: string[] = []
  let changedCount = 0
  let droppedCount = 0

  rows.forEach((row, i) => {
    const original = hooks[i]!
    const text = typeof row.text === 'string' ? row.text.trim() : ''
    const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
    if (row.keep === false) {
      droppedCount++
      notes.push(`dropped: "${original.text}"${reason ? ` — ${reason}` : ''}`)
      return
    }
    if (!text) {
      // Editor returned nothing usable for this slot — keep the original rather
      // than silently shrinking the batch.
      out.push(original)
      return
    }
    // vocalGender is the drafter's call, not the editor's; carry it across by index.
    out.push({ text, vocalGender: original.vocalGender })
    if (text !== original.text) {
      changedCount++
      notes.push(`"${original.text}" → "${text}"${reason ? ` — ${reason}` : ''}`)
    }
  })

  return {
    hooks: out,
    editorVersion: prompt.version,
    changedCount,
    droppedCount,
    notes,
    fellBack: false,
  }
}
