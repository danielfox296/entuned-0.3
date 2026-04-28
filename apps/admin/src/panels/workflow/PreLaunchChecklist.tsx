import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function PreLaunchChecklist({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Pre-Launch Checklist"
      intent="Single page that says go / no-go for taking this store live. Every gate green or it's not ready."
      steps={[
        'Store has a timezone and default outcome',
        'At least one ICP exists',
        'Hooks approved for every active outcome',
        'Reference tracks analyzed (≥ N per ICP)',
        'Pool depth above floor across the schedule',
        'Outcome schedule set for the next 7 days',
        'A player is paired and last-pinged within 24h',
      ]}
    />
  )
}
