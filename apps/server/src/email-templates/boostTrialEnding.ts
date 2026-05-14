// Boost Trial — 5-day ending warning.
//
// Fires from compExpiry.ts when compExpiresAt is within 5 days and
// compReason = 'boost_trial_icp'. Distinct from the standard compEnding
// template — tighter window, Boost-specific copy, no mention of the
// "admin comp" frame.
//
// LIFECYCLE-class: opt-out gated.

import { layout, button } from './_layout.js'

export interface BoostTrialEndingProps {
  daysRemaining: number
  upgradeUrl: string
  dashboardUrl: string
}

export function subject(props: BoostTrialEndingProps): string {
  return `Your Boost trial ends in ${props.daysRemaining} day${props.daysRemaining === 1 ? '' : 's'}`
}

export function html(props: BoostTrialEndingProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your Boost trial ends in ${props.daysRemaining} day${props.daysRemaining === 1 ? '' : 's'}.</p>
    <p style="margin:0 0 14px 0;">After that, the personalized library stops and you&rsquo;re back on Entuned Free (the shared retail catalogue). Your customer profile stays saved.</p>
    <p style="margin:0 0 14px 0;">Lock in Boost for $99 per location per month &mdash; no contracts, cancel any time.</p>
    ${button(props.upgradeUrl, 'Keep Boost — $99 / mo')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">If you&rsquo;re not ready, no action needed &mdash; you&rsquo;ll drop back to Free when the trial ends.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
  `
  return layout({
    preheader: `${props.daysRemaining} days left in your trial. Keep Boost for $99 / mo.`,
    body,
  })
}
