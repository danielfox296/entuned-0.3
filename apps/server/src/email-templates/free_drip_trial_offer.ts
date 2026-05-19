// Free drip day 12: 7-day Boost trial offer.
// LIFECYCLE-class.

import { layout, button } from './_layout.js'

export interface Props {
  trialUrl: string
}

export function subject(_props: Props): string {
  return 'Try Boost free for 7 days'
}

export function html(props: Props): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">7 days of Boost. No charge.</p>
    <p style="margin:0 0 14px 0;">Answer the seven ICP questions, get a private library built around your customer, and run it in your store for a week. If you don't hear the difference, walk away.</p>
    <p style="margin:0 0 14px 0;">If you do, it's $99 per location per month. No setup fee. No contracts.</p>
    ${button(props.trialUrl, 'Start 7-day trial')}
  `
  return layout({ preheader: '7-day trial. Private library, your ICP. No charge.', body })
}
