import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function HookRefresh({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Hook Refresh"
      intent="Regenerate draft hooks across every outcome for the active ICP, then bulk-review and approve."
      steps={[
        'List outcomes that lack approved hooks for this ICP',
        'Generate draft hooks per outcome (versioned prompt)',
        'Side-by-side compare new drafts vs current approved',
        'Bulk approve / discard / edit',
        'Stamp approved hooks with current prompt version',
      ]}
    />
  )
}
