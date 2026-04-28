import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function OnboardStore({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Onboard Store"
      intent="Cold-start wizard for a new store. Walks through every artifact a store needs before going live."
      steps={[
        'Confirm or create client',
        'Create store (name, timezone, default outcome)',
        'Author at least one ICP',
        'Generate first hooks per outcome',
        'Suggest and approve reference tracks',
        'Run style analysis on approved tracks',
        'Set initial outcome schedule',
        'Mark store ready to go live',
      ]}
    />
  )
}
