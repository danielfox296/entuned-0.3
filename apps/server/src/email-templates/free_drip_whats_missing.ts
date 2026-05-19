// Free drip day 7: what Boost unlocks. ICP customization + outcome scheduling.
// LIFECYCLE-class.

import { layout, button } from './_layout.js'

export interface Props {
  upgradeUrl: string
  playerUrl: string
}

export function subject(_props: Props): string {
  return "Here's what your music could be doing"
}

export function html(props: Props): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Free is the same library as every other Free store. Boost is yours.</p>
    <p style="margin:0 0 14px 0;">On Boost we ask seven questions about who walks in. Then we build a private library around them &mdash; not retail-in-general, but your customer.</p>
    <p style="margin:0 0 14px 0;">You also unlock Outcome Scheduling. Linger in the morning, Lift Energy at 4pm, AOV push when the dinner rush starts. The music tilts toward the outcome you want at the moment you want it.</p>
    ${button(props.upgradeUrl, 'Try Boost — $99 / location')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Your current player: <a href="${props.playerUrl}" style="color:#50929c;">${props.playerUrl}</a></p>
  `
  return layout({ preheader: 'ICP-tuned library. Outcome Scheduling. The actual product.', body })
}
