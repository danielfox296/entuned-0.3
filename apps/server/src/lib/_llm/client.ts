// Shared Anthropic client + small helpers for the LLM-calling pipeline modules
// (decomposer, bpm-lookup, bernie, mars anchor, hook drafter, professor,
// music-professor, flow renderer, ref-track suggester).
//
// Why this exists: every one of those modules had three copy-pasted concerns —
//   1. an `apiKey = process.env.ANTHROPIC_API_KEY` guard + `new Anthropic({apiKey})`,
//   2. a `process.env.X_MODEL ?? process.env.Y ?? 'default'` model fallback chain,
//   3. a `response.content.find((b:any) => b.type==='tool_use' && b.name===…) as any`
//      tool-use extraction.
// This module centralizes (1) and (3) and provides a clean (2) helper, WITHOUT
// centralizing the model choices themselves — each module keeps owning its env
// var name + default string and routes them through resolveModel().

import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

/**
 * Memoized Anthropic client. Resolves ANTHROPIC_API_KEY once; throws if missing.
 * Repeated calls reuse the same instance.
 */
export function getAnthropic(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  _client = new Anthropic({ apiKey })
  return _client
}

/**
 * First defined, non-empty candidate, else `fallback`. Maps the existing
 * chained `process.env.X_MODEL ?? process.env.Y ?? 'default'` patterns:
 *   resolveModel(process.env.X_MODEL, 'default')
 *   resolveModel(process.env.X_MODEL, process.env.Y, 'default')
 * The fallback is the last (required) argument; all earlier args are optional
 * candidates that are skipped when undefined or empty.
 */
export function resolveModel(...args: [...candidates: (string | undefined)[], fallback: string]): string {
  const fallback = args[args.length - 1] as string
  const candidates = args.slice(0, -1) as (string | undefined)[]
  for (const c of candidates) {
    if (c !== undefined && c !== '') return c
  }
  return fallback
}

/**
 * Return the `input` of the first `tool_use` block whose name matches
 * `toolName`, or null. Replaces the repeated
 * `response.content.find((b:any) => b.type==='tool_use' && b.name===…)` + casts.
 *
 * Returns `unknown` so callers narrow/cast at the use site exactly as they did
 * before (the previous `as any` on the block's `.input`).
 */
export function extractToolUse(
  response: { content: Array<{ type: string; name?: string; input?: unknown }> },
  toolName: string,
): unknown {
  const block = response.content.find(
    (b) => b.type === 'tool_use' && b.name === toolName,
  )
  return block ? (block as { input?: unknown }).input ?? null : null
}

/** Test-only: reset the memoized client so a test can re-trigger the key guard. */
export function _resetAnthropicForTests(): void {
  _client = null
}
