// Free drip day 14: final nudge. Social proof + clear CTA.
// LIFECYCLE-class. Last email in the sequence.

import { layout, button } from './_layout.js'

export interface Props {
  upgradeUrl: string
}

export function subject(_props: Props): string {
  return 'Still using generic music?'
}

export function html(props: Props): string {
  const body = `
    <p style="margin:0 0 14px 0;">Two weeks in on Entuned Free. The library is solid &mdash; same one every store starts with.</p>
    <p style="margin:0 0 14px 0;">But if you want music that actually moves the needle, you need it tuned to <em>your</em> customer, not retail-in-general. That's what Boost is.</p>
    <p style="margin:0 0 14px 0;">$99 per location per month. ICP-tuned library, Outcome Scheduling, your own catalogue. Cancel any time. We won't bug you about this again.</p>
    ${button(props.upgradeUrl, 'Upgrade to Boost')}
  `
  return layout({ preheader: 'Last note. $99/location. Music tuned to your customer.', body })
}
