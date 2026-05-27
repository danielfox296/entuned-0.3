import { T } from '@entuned/tokens'
import { S } from '../../ui/index.js'
import { HookDrafterPrompt } from './HookDrafterPrompt.js'
import { OutcomeLyricFactor } from './OutcomeLyricFactor.js'

// Combined Hooks editor. The system prompt at top sets craft (universal); the
// per-outcome direction table below sets *what to write about* for each Outcome.
// Both fire together on every hook draft.
export function Hooks() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <HookDrafterPrompt />
      <div style={{ height: 1, background: T.borderSubtle, margin: '8px 0' }} />
      <OutcomeLyricFactor />
    </div>
  )
}
