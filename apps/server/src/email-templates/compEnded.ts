// Comp ended — operator-granted free upgrade just expired.
//
// Fires from the daily cron immediately after a comp's `compExpiresAt`
// passes. The Store has already fallen back to its paid tier (effective ==
// paid). This email is the offer to undo that drop.
//
// LIFECYCLE-class email.

import { layout, button } from './_layout.js'

export interface CompEndedProps {
  // The tier they had as a comp (now lost).
  formerCompTier: string
  // What they're back on.
  paidTier: string
  // One-click path to upgrade for real.
  upgradeUrl: string
  dashboardUrl: string
}

export function subject(props: CompEndedProps): string {
  return `Your ${capitalize(props.formerCompTier)} upgrade ended — pick up where you left off?`
}

export function html(props: CompEndedProps): string {
  const isToFree = props.paidTier === 'free' || props.paidTier === 'mvp_pilot'
  const baselineCopy = isToFree
    ? `You&rsquo;re back on the free Essentials tier &mdash; the player still works, but you lose the ${capitalize(props.formerCompTier)} features.`
    : `You&rsquo;re back on ${capitalize(props.paidTier)}, which you&rsquo;ve been paying for the whole time.`

  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your ${capitalize(props.formerCompTier)} upgrade just ended.</p>
    <p style="margin:0 0 14px 0;">${baselineCopy}</p>
    <p style="margin:0 0 14px 0;">If you want to keep ${capitalize(props.formerCompTier)}, the upgrade is one click away. We&rsquo;ll prorate so you only pay from today.</p>
    ${button(props.upgradeUrl, `Upgrade to ${capitalize(props.formerCompTier)}`)}
    <p style="margin:18px 0 0 0;">Or stay where you are &mdash; no further action needed.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions? Just reply.</p>
  `
  return layout({ preheader: `Your ${capitalize(props.formerCompTier)} upgrade ended. One click brings it back.`, body })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
