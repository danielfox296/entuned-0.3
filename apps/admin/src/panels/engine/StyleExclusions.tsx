import { T } from '@entuned/tokens'
import { S } from '../../ui/index.js'
import { FailureRules } from './FailureRules.js'
import { MarsStyleAxes } from './MarsStyleAxes.js'

// Combined negative-style steering. All three sub-tables feed buildNegativeStyle()
// on every Mars assembly: trigger-based exclusions (top), always-fire contamination
// terms + per-axis opposite-style rules (below).
export function StyleExclusions() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl }}>
      <FailureRules />
      <div style={{ height: 1, background: T.borderSubtle, margin: '8px 0' }} />
      <MarsStyleAxes />
    </div>
  )
}
