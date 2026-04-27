import { api, getToken } from '../../api.js'
import { VersionedPromptEditor } from '../../ui/index.js'

export function StyleTemplate() {
  return (
    <VersionedPromptEditor
      title="Style Template"
      subtitle="Mars long-style assembly template (text/provenance — runtime logic stays code-backed)"
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        const r = await api.styleTemplate(token)
        return { latest: r.latest, history: r.history }
      }}
      textFrom={(latest) => latest?.templateText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveStyleTemplate(text, notes, token)
      }}
    />
  )
}
