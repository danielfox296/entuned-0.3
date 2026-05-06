// Comp ending soon — operator-granted free upgrade is about to expire.
//
// Fires from the daily lifecycle cron when `Store.compExpiresAt` is within
// the warning window (default 7 days). The recipient is currently enjoying
// effective tier > paid tier; this email gives them a heads-up + a one-
// click path to convert the upgrade into a real Stripe price change.
//
// LIFECYCLE-class email: opt-out gated, unsub footer attached. (Even though
// it has billing implications, it is not blocking — they keep their
// effective tier until the comp actually expires, at which point compEnded
// fires as the last word.)

import { layout, button } from './_layout.js'

export interface CompEndingProps {
  // What they're currently getting (the comp tier — e.g. "Pro").
  effectiveTier: string
  // What they're paying for today (e.g. "Core" — or "Free" for free→paid comps).
  paidTier: string
  // Days until comp expires (already rounded by the cron).
  daysRemaining: number
  // Human date for "ends on Aug 12, 2026".
  endsOn: string
  // One-click path to keep the upgrade. For Core→Pro this hits a price-swap
  // endpoint; for Free→paid it's a normal Stripe Checkout URL.
  upgradeUrl: string
  // Where to land if they want to do nothing — usually the dashboard.
  dashboardUrl: string
}

export function subject(props: CompEndingProps): string {
  return `Your free ${capitalize(props.effectiveTier)} upgrade ends ${props.endsOn}`
}

export function html(props: CompEndingProps): string {
  const isFromFree = props.paidTier === 'free' || props.paidTier === 'mvp_pilot'
  const stayCopy = isFromFree
    ? `If you do nothing, your account drops back to Entuned Free on ${props.endsOn}.`
    : `If you do nothing, you stay on ${capitalize(props.paidTier)} at your current price &mdash; nothing changes about your billing.`

  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">A heads-up: your ${capitalize(props.effectiveTier)} upgrade ends in ${props.daysRemaining} day${props.daysRemaining === 1 ? '' : 's'}.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;ve been on ${capitalize(props.effectiveTier)} as a comp from us. That ends on <strong style="color:#E8E4DE;">${props.endsOn}</strong>.</p>
    <p style="margin:0 0 14px 0;">Two options:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">Keep ${capitalize(props.effectiveTier)}.</strong> One click and the upgrade becomes a real subscription change &mdash; we&rsquo;ll handle the proration.</p>
    ${button(props.upgradeUrl, `Keep ${capitalize(props.effectiveTier)}`)}
    <p style="margin:18px 0 6px 0;"><strong style="color:#d7af74;">Stay on ${capitalize(props.paidTier)}.</strong> ${stayCopy}</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions? Reply to this email &mdash; it goes to a real person.</p>
  `
  return layout({ preheader: `Your ${capitalize(props.effectiveTier)} upgrade ends in ${props.daysRemaining} day${props.daysRemaining === 1 ? '' : 's'}.`, body })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
