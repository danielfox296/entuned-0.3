import { api, getToken } from '../../api.js'
import type { LyricPromptRow } from '../../api.js'
import { VersionedPromptEditor } from '../../ui/index.js'

export function BpmLookupPrompt() {
  return (
    <VersionedPromptEditor
      title="BPM Lookup Prompt"
      subtitle="System prompt for the cheap BPM-only side route (Haiku + one web_search call). Used by the BPM backfill endpoint."
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        const r = await api.bpmLookupPrompt(token)
        return { latest: r.latest, history: r.history }
      }}
      textFrom={(latest: LyricPromptRow | null) => latest?.promptText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveBpmLookupPrompt(text, notes, token)
      }}
    />
  )
}
