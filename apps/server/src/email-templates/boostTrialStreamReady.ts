// Boost Trial — stream ready notification.
//
// Fires 1-3 days after the Boost Trial clock activates (i.e., after the first
// LineageRow is generated for the onboarding ICP). Tells the customer their
// personalized library is generating and gives them the player link + a reminder
// of how many trial days they have.
//
// LIFECYCLE-class: opt-out gated.

import { layout, button } from './_layout.js'

export interface BoostTrialStreamReadyProps {
  playerUrl: string
  dashboardUrl: string
  daysRemaining: number
}

export function subject(_props: BoostTrialStreamReadyProps): string {
  return 'Your Boost library is generating'
}

export function html(props: BoostTrialStreamReadyProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your Boost library is generating.</p>
    <p style="margin:0 0 14px 0;">We took your answers and started building. The first tracks built around your specific customer are on their way &mdash; you&rsquo;ll hear the difference in the first hour of playback.</p>
    <p style="margin:0 0 14px 0;">Open the player on whatever device drives your shop&rsquo;s speakers. Pick an outcome. The library plays.</p>
    ${button(props.playerUrl, 'Open player')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Your trial: <strong style="color:#d4e1e5;">${props.daysRemaining} days</strong> of Boost, on us. The dashboard is where you manage outcomes, update your customer profile, and track your account.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Reply here &mdash; it goes to a real person.</p>
  `
  return layout({ preheader: 'Your personalized library is being built. Open the player to hear it.', body })
}
