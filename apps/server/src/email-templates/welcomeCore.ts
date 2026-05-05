// Welcome — Core variant.
// Sent after Core checkout completion. Same two-step CTA as Free, no
// upsell card, copy oriented toward "finish your store profile".
// DB-editable via the admin Email panel; this file is the TS fallback.

import { layout, button } from './_layout.js'

export interface WelcomeCoreProps {
  playerUrl: string
  dashboardUrl: string
}

export function subject(_props: WelcomeCoreProps): string {
  return 'Welcome to Entuned Core'
}

export function html(props: WelcomeCoreProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on Core.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; finish your store profile so we can build the catalogue.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; sign in on the in-store device once your catalogue is ready.</p>
    ${button(props.playerUrl, 'Open player')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions go to founder@entuned.co. Replies hit a real person.</p>
  `
  return layout({ preheader: 'Your Core account is active. Two next steps inside.', body })
}
