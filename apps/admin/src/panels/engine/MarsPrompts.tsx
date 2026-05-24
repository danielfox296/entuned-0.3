import { useState } from 'react'
import { api, getToken } from '../../api.js'
import type { LyricPromptRow } from '../../api.js'
import { T } from '@entuned/tokens'
import { VersionedPromptEditor, S } from '../../ui/index.js'

// Mars LLM-builder system prompts — anchor (default) and router (legacy
// fallback). DB-backed, same versioned-edit pattern as Lyric Prompts.
// Schema SSOT: ../../../entune v0.3/schema/light-cards.md (Card 12 — Mars,
// "StyleAnchorPrompt and StyleRouterPrompt" section).

type Kind = 'anchor' | 'router'

const LABEL: Record<Kind, string> = {
  anchor: 'anchor (default)',
  router: 'router (legacy)',
}

export function MarsPrompts() {
  const [kind, setKind] = useState<Kind>('anchor')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['anchor', 'router'] as const).map((k) => (
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
          >{LABEL[k]}</button>
        ))}
      </div>

      {/* Re-mount on kind change so VersionedPromptEditor reloads cleanly. */}
      <VersionedPromptEditor
        key={kind}
        title={`Mars Prompt — ${LABEL[kind]}`}
        subtitle="System prompt for the Mars LLM style builder. STYLE_BUILDER env var (anchor | router) selects which one runs at generation time."
        load={async () => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          const r = await api.marsPrompts(token)
          return { latest: r[kind].latest, history: r[kind].history }
        }}
        textFrom={(latest: LyricPromptRow | null) => latest?.promptText ?? ''}
        save={async (text, notes) => {
          const token = getToken(); if (!token) throw new Error('not signed in')
          if (kind === 'anchor') await api.saveAnchorPrompt(text, notes, token)
          else await api.saveRouterPrompt(text, notes, token)
        }}
      />
    </div>
  )
}
