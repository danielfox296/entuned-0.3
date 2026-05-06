// Welcome — free / essentials variant.
//
// Sent on first sign-in (auto-provisioned free account). Two-step "open
// dashboard / open player" CTA + a soft Core upsell.
// DB-editable via the admin Email panel; this file is the TS fallback.

import { layout, button } from './_layout.js'

export interface WelcomeFreeProps {
  playerUrl: string
  dashboardUrl: string
}

export function subject(_props: WelcomeFreeProps): string {
  return 'Welcome to Entuned Essentials'
}

export function html(props: WelcomeFreeProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on Essentials.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; manage your account and add a location.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; open this on any speaker you already have. Pick Increase Dwell or Infuse Energy to start playing.</p>
    ${button(props.playerUrl, 'Open player')}
    <p style="margin:18px 0 0 0;font-size:14px;">Ready for music tuned to your specific customer? <a href="https://entuned.co/pricing.html" style="color:#d7af74;">Unlock Core</a> for a private library built around the people who actually walk into your store.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Replies hit a real person.</p>
  `
  return layout({ preheader: 'Your Essentials account is active. Two next steps inside.', body })
}
