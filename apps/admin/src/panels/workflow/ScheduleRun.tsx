import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function ScheduleRun({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Schedule Run"
      intent="Pick outcomes for the upcoming week, dry-run against the schedule simulator, then publish."
      steps={[
        'Load current weekly grid for this store',
        'Edit outcome assignments per timeslot',
        'Dry-run: preview what would play and pool draw per slot',
        'Surface schedule conflicts or pool shortfalls',
        'Publish the schedule',
      ]}
    />
  )
}
