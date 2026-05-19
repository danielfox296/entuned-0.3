// Free drip day 10: full pilot narrative. Before / after.
// LIFECYCLE-class.

import { layout, button } from './_layout.js'

export interface Props {
  upgradeUrl: string
}

export function subject(_props: Props): string {
  return 'From Spotify playlists to 28% conversion'
}

export function html(props: Props): string {
  const body = `
    <p style="margin:0 0 14px 0;">Before: Spotify in the morning, Cloud Cover the rest of the day. Kari, the assistant manager: <em>"we hear the same songs 3 times a day. i'm sick of this shit. you know, some of them are actually good songs, but i've been hearing them on a 4 hour loop for 18 months."</em></p>
    <p style="margin:0 0 14px 0;">After we switched the store to Entuned: a customer singing along to lyrics that said "add it to the pile" and grabbing another shirt. 18% to 28% conversion on the day. Staff who stopped tuning out.</p>
    <p style="margin:0 0 14px 0;">The mechanism: every track is composed for a specific outcome &mdash; Linger, Lift Energy, AOV, Dwell &mdash; with lyrics that prime the action without sounding like an ad. Customers do what the song tells them to do, and they think it's their idea.</p>
    ${button(props.upgradeUrl, 'Run it in your store')}
  `
  return layout({ preheader: 'The pilot store, in their own words.', body })
}
