import { useState } from 'react'
import { api, getToken } from '../../api.js'
import type { LyricPromptRow } from '../../api.js'
import { T } from '../../tokens.js'
import { VersionedPromptEditor, S } from '../../ui/index.js'

type Kind = 'draft' | 'edit'

export function LyricPrompts() {
  const [kind, setKind] = useState<Kind>('draft')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['draft', 'edit'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            style={{
              background: kind === k ? T.surfaceRaised : 'transparent',
              border: `1px solid ${kind === k ? T.accent : T.border}`,
              color: kind === k ? T.accent : T.textMuted,
              padding: '6px 14px', borderRadius: S.r4,
              fontFamily: T.sans, fontSize: S.small, cursor: 'pointer',
            }}
          >{k}</button>
        ))}
      </div>

      {/* Re-mount on kind change so VersionedPromptEditor reloads cleanly. */}
      <VersionedPromptEditor
        key={kind}
        title={`Lyric Prompt — ${kind}`}
        subtitle="Bernie draft and edit prompts (Anthropic-side lyric generation)"
        load={async () => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          const r = await api.lyricPrompts(token)
          return { latest: r[kind].latest, history: r[kind].history }
        }}
        textFrom={(latest: LyricPromptRow | null) => latest?.promptText ?? ''}
        save={async (text, notes) => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          if (kind === 'draft') await api.saveDraftPrompt(text, notes, token)
          else await api.saveEditPrompt(text, notes, token)
        }}
      />
    </div>
  )
}
