import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function FeedbackTriage({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Feedback Triage"
      intent="Recent operator and customer signals for this store — flagged songs, outcome overrides, retire candidates."
      steps={[
        'Recent flagged songs (last 7 days)',
        'Outcome override events vs scheduled outcome',
        'Songs with high skip rate → retire candidates',
        'Operator feedback notes',
        'One-click retire / promote actions',
      ]}
    />
  )
}
