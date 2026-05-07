// ICP-unfilled lifecycle nudge.
//
// Fired by the daily lifecycle cron ~48h after a paid Store is created if
// the Store still has no ICP saved. Reminds the operator that the catalogue
// quality lift waiting for them is gated on Customer Profile.
//
// LIFECYCLE-class email: subject to user.lifecycleEmailsOptOut and includes
// an unsubscribe footer (added by the renderer).

import { layout, button } from './_layout.js'

export interface IcpUnfilledProps {
  intakeUrl: string
}

export function subject(_props: IcpUnfilledProps): string {
  return 'Two minutes to a library built around your customer'
}

export function html(props: IcpUnfilledProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Two minutes to a library built around your customer.</p>
    <p style="margin:0 0 14px 0;">Your Core account can be tuned to the people who actually walk into your store. The seven Customer Profile questions are what we tune it from &mdash; about who they are, what they value, what would make them leave.</p>
    ${button(props.intakeUrl, 'Set up Customer Profile')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Fill it once and we get out of the way &mdash; you can come back and re-tune any time.</p>
  `
  return layout({ preheader: 'Customer Profile tunes the library to your audience. Two minutes.', body })
}
