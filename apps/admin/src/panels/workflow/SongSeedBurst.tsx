import { StubPanel } from './_shared.js'
import type { WorkflowContext } from './WorkflowRouter.js'

export function SongSeedBurst({ ctx }: { ctx: WorkflowContext }) {
  return (
    <StubPanel
      ctx={ctx}
      title="Song Seed Burst"
      intent="Claim N song seeds for the active store / ICP and walk through Suno generation in one sitting."
      steps={[
        'Pick outcomes to seed against (default: low-pool first)',
        'Choose burst size (e.g. 5 / 10 / 25)',
        'Claim seeds atomically',
        'Open Suno paste flow per seed',
        'Accept / close takes inline',
        'Summary of accepted vs closed at the end',
      ]}
    />
  )
}
