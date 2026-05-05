// ICP-unfilled lifecycle nudge.
//
// Fired by the daily lifecycle cron ~48h after a paid Store is created if
// the Store still has no ICP saved. Reminds the operator that the catalogue
// quality lift waiting for them is gated on Brand Intake.
//
// LIFECYCLE-class email: subject to user.lifecycleEmailsOptOut and includes
// an unsubscribe footer (added by the renderer).

import { layout, button } from './_layout.js'

export interface IcpUnfilledProps {
  intakeUrl: string
}

export function subject(_props: IcpUnfilledProps): string {
  return 'Two minutes to better music for your store'
}

export function html(props: IcpUnfilledProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You upgraded. We&rsquo;re still playing the average shopper.</p>
    <p style="margin:0 0 14px 0;">Until you fill out Brand Intake, your player runs on the general catalogue &mdash; the one tuned for nobody in particular. Seven questions, two minutes, and we shift the library to fit your specific customer.</p>
    ${button(props.intakeUrl, 'Open Brand Intake')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">If your customer really is "everyone" &mdash; ignore this. Otherwise, the music gets noticeably better the moment you tell us who walks in.</p>
  `
  return layout({ preheader: 'Brand Intake unlocks tailored music. Two minutes.', body })
}
