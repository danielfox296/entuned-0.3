import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function ReferenceTrackRefresh({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Reference Track Refresh"
      intent="Suggest new reference tracks for the active ICP, approve, and trigger style analysis."
      steps={[
        'Run reference-track suggester against the ICP profile',
        'Review suggested tracks (Spotify metadata + rationale)',
        'Approve or reject each',
        'Queue style analysis for approved tracks',
        'Monitor analysis completion',
      ]}
    />
  )
}
