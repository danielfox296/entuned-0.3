// Lyric draft prompt — Bernie's single-pass system prompt.
//
// The former "edit" toggle was retired 2026-05-25 when Bernie collapsed to a
// single-pass drafter and the Professor module took over post-draft craft
// finishing. The lyric_edit_prompts table is retained for historical
// SongSeed provenance but is no longer read at runtime.

import { api, getToken } from '../../api.js'
import type { LyricPromptRow } from '../../api.js'
import { VersionedPromptEditor } from '../../ui/index.js'

export function LyricPrompts() {
  return (
    <VersionedPromptEditor
      title="Lyric Prompt — Draft"
      subtitle="Bernie's single-pass system prompt. Post-draft craft finishing is the Professor's job — edit that under the Professor panel."
      load={async () => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        const r = await api.lyricPrompts(token)
        return { latest: r.draft.latest, history: r.draft.history }
      }}
      textFrom={(latest: LyricPromptRow | null) => latest?.promptText ?? ''}
      save={async (text, notes) => {
        const token = getToken(); if (!token) throw new Error('not signed in')
        await api.saveDraftPrompt(text, notes, token)
      }}
    />
  )
}
