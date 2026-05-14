// Boost Trial — trial expired.
//
// Fires from compExpiry.ts after the 3-day grace period when the Boost Trial
// comp is cleared. Sent at most once per store (compExpiry uses no idempotency
// key for ended emails, but clearing the comp is idempotent so duplicates
// can't happen).
//
// LIFECYCLE-class: opt-out gated.

import { layout, button } from './_layout.js'

export interface BoostTrialExpiredProps {
  upgradeUrl: string
  dashboardUrl: string
}

export function subject(_props: BoostTrialExpiredProps): string {
  return 'Your Boost trial ended — keep it for $99 / mo'
}

export function html(props: BoostTrialExpiredProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your Boost trial ended.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;re back on Entuned Free. The personalized library built around your customer is paused &mdash; your customer profile and all your settings are still saved.</p>
    <p style="margin:0 0 14px 0;">Upgrade to keep the library running. $99 per location per month, no contracts, cancel any time.</p>
    ${button(props.upgradeUrl, 'Upgrade to Boost')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Or stay on Free &mdash; no further action needed. If you upgrade later, we pick up where you left off.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
  `
  return layout({ preheader: 'Your Boost trial ended. Upgrade to keep the personalized library running.', body })
}
