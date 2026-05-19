// Free drip day 2: "The channel you're not designing."
//
// Frames the "two channels" thesis — visual is designed, audio is rented.
// LIFECYCLE-class.

import { layout, button } from './_layout.js'

export interface Props {
  upgradeUrl: string
  playerUrl: string
}

export function subject(_props: Props): string {
  return "The channel you're not designing"
}

export function html(props: Props): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your store has two channels. You design one.</p>
    <p style="margin:0 0 14px 0;">Visual: paint, lighting, fixtures, fit kit, the way the floor flows. You design every inch of it. You hire people to help.</p>
    <p style="margin:0 0 14px 0;">Audio: the same Spotify or Cloud Cover loop, shared with the dry-cleaner next door and the dentist across the street. Customer's brain can't tell whose store they're in.</p>
    <p style="margin:0 0 14px 0;">That's the channel you're not designing. Entuned is the channel you can.</p>
    ${button(props.playerUrl, 'Open your player')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">When you're ready: <a href="${props.upgradeUrl}" style="color:#50929c;">upgrade to Boost</a>.</p>
  `
  return layout({ preheader: "Two channels. Visual you design. Audio you rent. Until now.", body })
}
