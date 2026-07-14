// Welcome — Entuned Free variant.
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
  return 'Welcome to Entuned Free'
}

export function html(props: WelcomeFreeProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">You&rsquo;re on Entuned Free.</p>
    <p style="margin:0 0 14px 0;"><strong style="color:#50929c;">Start here:</strong> open the player on whatever device drives your shop&rsquo;s speakers (the laptop behind the counter, an iPad, a Bluetooth-paired phone). Pick Chill, Steady, or Upbeat. Music starts.</p>
    <p style="margin:0 0 14px 0;">One thing to know: the free catalogue is shared by every store and deliberately broad &mdash; it&rsquo;s tuned to a mood, not to your customer. When a track comes on that doesn&rsquo;t sound like your shop, you&rsquo;ve found the free tier&rsquo;s real limit &mdash; the one Boost removes with a library built around your customer.</p>
    ${button(props.playerUrl, 'Open player')}
    <p style="margin:22px 0 6px 0;font-size:14px;color:#8a929a;">When you have a minute &mdash; the dashboard is where you manage your account, add another location, or upgrade.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:14px;">Ready for music tuned to your specific customer? <a href="https://entuned.co/pricing.html" style="color:#50929c;">Unlock Boost</a> &mdash; answer seven questions about who walks in and we build a private library around them.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Replies hit a real person.</p>
  `
  return layout({ preheader: 'Open the player on the device that drives your shop speakers. Pick a mode. Music starts.', body })
}
