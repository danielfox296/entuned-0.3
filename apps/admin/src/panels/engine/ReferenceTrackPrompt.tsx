import { api, getToken } from '../../api.js'
import { VersionedPromptEditor } from '../../ui/index.js'

export function ReferenceTrackPrompt() {
  return (
    <VersionedPromptEditor
      title="Reference Track Suggester"
      subtitle="System prompt for the Claude call that proposes ICP reference tracks (PreFormation / FormationEra / Subculture / Aspirational / Adjacent). The ICP's psychographic profile is appended automatically as the user message — no template tokens. Output JSON only."
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        const r = await api.referenceTrackPrompt(token)
        return { latest: r.latest, history: r.history }
      }}
      textFrom={(latest) => latest?.templateText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveReferenceTrackPrompt(text, notes, token)
      }}
      minHeight={360}
    />
  )
}
