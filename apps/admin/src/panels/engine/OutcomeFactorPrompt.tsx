import { api, getToken } from '../../api.js'
import { VersionedPromptEditor } from '../../ui/index.js'

export function OutcomeFactorPrompt() {
  return (
    <VersionedPromptEditor
      title="Outcome Style Factor"
      subtitle=""
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        const r = await api.outcomeFactorPrompt(token)
        return { latest: r.latest, history: r.history }
      }}
      textFrom={(latest) => latest?.templateText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveOutcomeFactorPrompt(text, notes, token)
      }}
      minHeight={220}
    />
  )
}
