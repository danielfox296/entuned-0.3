import { api, getToken } from '../../api.js'
import type { LyricPromptRow } from '../../api.js'
import { VersionedPromptEditor } from '../../ui/index.js'

// Style anchor system prompt — the LLM-builder prompt for the live Suno style
// builder. Single DB-backed prompt, versioned. The legacy router prompt was
// removed 2026-05-26 once STYLE_BUILDER=anchor became the only production
// path. Schema SSOT: ../../../entune v0.3/schema/light-cards.md (Card 12 — Mars).

export function MarsPrompts() {
  return (
    <VersionedPromptEditor
      title="Style Prompt"
      subtitle="System prompt for the LLM that builds Suno's style + negative-style fields (Anchor-and-Carve)."
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        return await api.stylePrompt(token)
      }}
      textFrom={(latest: LyricPromptRow | null) => latest?.promptText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveStylePrompt(text, notes, token)
      }}
    />
  )
}
