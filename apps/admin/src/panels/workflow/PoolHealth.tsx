import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function PoolHealth({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Pool Health Check"
      intent="Inspect pool depth per outcome for this store and trigger seed bursts where coverage is thin."
      steps={[
        'Read pool depth per outcome × ICP',
        'Flag outcomes below floor threshold',
        'Estimate seed bursts needed to reach target',
        'Enqueue song seeds for low pools',
        'Track generation progress',
      ]}
    />
  )
}
