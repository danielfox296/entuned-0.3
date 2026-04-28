import { api, getToken } from '../../api.js'
import { VersionedPromptEditor, History as SharedHistory } from '../../ui/index.js'
import type { PromptVersion } from '../../ui/index.js'

export function DecomposerRules() {
  return (
    <VersionedPromptEditor
      title="Decomposition"
      subtitle=""
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        const r = await api.musicologicalRules(token)
        return { latest: r.latest, history: r.history }
      }}
      textFrom={(latest) => latest?.rulesText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveMusicologicalRules(text, notes, token)
      }}
      minHeight={420}
    />
  )
}

// Re-exported for any panels still importing from here.
export { SharedHistory as History }
export function Header(_: { title: string; subtitle: string; version?: number; createdAt?: string }) {
  return null
}
export type { PromptVersion }
