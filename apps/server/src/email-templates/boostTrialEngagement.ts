// Boost Trial — Day 14 mid-trial engagement.
//
// Fires around Day 14 of the active trial. By this point the customer has had
// two weeks of the personalized library. The email acknowledges the usage,
// surfaces the upgrade path, and reminds them of the 30-day window.
//
// LIFECYCLE-class: opt-out gated.

import { layout, button } from './_layout.js'

export interface BoostTrialEngagementProps {
  daysRemaining: number
  upgradeUrl: string
  dashboardUrl: string
}

export function subject(props: BoostTrialEngagementProps): string {
  return `${props.daysRemaining} days left on your Boost trial`
}

export function html(props: BoostTrialEngagementProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Two weeks in on Boost.</p>
    <p style="margin:0 0 14px 0;">The library built around your customer has been running for two weeks. You&rsquo;ve got <strong style="color:#d4e1e5;">${props.daysRemaining} days</strong> left in the trial.</p>
    <p style="margin:0 0 14px 0;">If it&rsquo;s been doing its job, locking it in is $99 per location per month &mdash; no setup fee, cancel any time. One click to keep the library going after the trial ends.</p>
    ${button(props.upgradeUrl, 'Keep Boost — $99 / mo')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Not ready yet? Your trial keeps running. The library stays on until day 30.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
  `
  return layout({ preheader: `${props.daysRemaining} days left on your Boost trial. Keep it for $99 / mo.`, body })
}
