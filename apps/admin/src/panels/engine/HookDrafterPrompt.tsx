import { api, getToken } from '../../api.js'
import type { LyricPromptRow } from '../../api.js'
import { VersionedPromptEditor } from '../../ui/index.js'

export function HookDrafterPrompt() {
  return (
    <VersionedPromptEditor
      title="System Prompt"
      subtitle="Universal craft rules for hook generation. Per-outcome direction is layered on top via the Outcome Hook Prompt table below."
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        const r = await api.hookDrafterPrompt(token)
        return { latest: r.latest, history: r.history }
      }}
      textFrom={(latest: LyricPromptRow | null) => latest?.promptText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveHookDrafterPrompt(text, notes, token)
      }}
    />
  )
}
