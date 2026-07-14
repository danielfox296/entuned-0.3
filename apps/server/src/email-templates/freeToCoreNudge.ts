// Free-to-Core upgrade nudge.
//
// Fired by the daily lifecycle cron ~72h after a free signup if the Client
// has not added a paid subscription. Frames the upgrade as a quality lift
// rather than a feature unlock.
//
// LIFECYCLE-class email: subject to user.lifecycleEmailsOptOut and includes
// an unsubscribe footer (added by the renderer).

import { layout, button } from './_layout.js'

export interface FreeToCoreNudgeProps {
  upgradeUrl: string
  playerUrl: string
}

export function subject(_props: FreeToCoreNudgeProps): string {
  return 'Music tuned to who actually walks into your store'
}

export function html(props: FreeToCoreNudgeProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">On Boost, your library is built around your customer.</p>
    <p style="margin:0 0 14px 0;">Entuned Free gives you a soundtrack engineered for retail in general &mdash; Chill, Steady, or Upbeat on a 100+ song shared catalogue. It&rsquo;s the same one every store starts on, broad across styles by design &mdash; which is why some tracks won&rsquo;t sound like your store.</p>
    <p style="margin:0 0 14px 0;">On Boost, you answer seven questions about who walks in and we build a private library around them. All research-backed outcomes unlocked. $99 per location, per month. No setup fee, no contracts, cancel any time.</p>
    ${button(props.upgradeUrl, 'Unlock Boost')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Your current player: <a href="${props.playerUrl}" style="color:#50929c;">${props.playerUrl}</a></p>
  `
  return layout({ preheader: 'A library built around your customer. $99 / location / month.', body })
}
