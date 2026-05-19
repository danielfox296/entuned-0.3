// Free drip day 4: "Add it to the pile" story + Kari's conversion quote.
// Pure proof email — no sell, just the data and the moments.
// LIFECYCLE-class.

import { layout, button } from './_layout.js'

export interface Props {
  upgradeUrl: string
  playerUrl: string
}

export function subject(_props: Props): string {
  return 'A customer told us exactly why this works'
}

export function html(props: Props): string {
  const body = `
    <p style="margin:0 0 14px 0;">We ran a track at the pilot store. The chorus said "add it to the pile."</p>
    <p style="margin:0 0 14px 0;">A customer sang along to it. Then she grabbed another shirt off the rack and said "this is brilliant." She narrated the mechanism out loud without knowing it existed.</p>
    <p style="margin:0 0 14px 0;">Same day: Kari, the assistant manager, watched conversion go from 18% to 28%. She didn't know what we were testing.</p>
    <p style="margin:0 0 14px 0;">That's what behavioral audio is. Not background music. Not vibe. Music designed to lift a specific outcome, and lyrics that tell the customer what to do.</p>
    ${button(props.playerUrl, 'Open your player')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">When you're ready for music tuned to your ICP: <a href="${props.upgradeUrl}" style="color:#50929c;">upgrade to Boost</a>.</p>
  `
  return layout({ preheader: '18% to 28% in one day. A customer narrated the mechanism.', body })
}
