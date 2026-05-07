// Welcome — Pro variant.
// Sent after Pro checkout completion. Adds the 48-hour human review note.
// DB-editable via the admin Email panel; this file is the TS fallback.

import { layout, button } from './_layout.js'

export interface WelcomeProProps {
  playerUrl: string
  dashboardUrl: string
}

export function subject(_props: WelcomeProProps): string {
  return 'Welcome to Entuned Pro'
}

export function html(props: WelcomeProProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on Pro.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; fill out Customer Profile so we can build a library around your customer.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; sign in on the in-store device once your library is ready.</p>
    ${button(props.playerUrl, 'Open player')}
    <p style="margin:14px 0 0 0;">Pro includes a human review pass on your first library. Expect a note from us within 48 hours after Customer Profile is in.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Replies hit a real person.</p>
  `
  return layout({ preheader: 'Your Pro account is active. Two next steps inside.', body })
}
