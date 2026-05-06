// Behavioral upgrade trigger — Free → Core, "engaged" signal.
//
// Distinct from `freeToCoreNudge` (which fires 72h after signup based on time
// alone). This fires for free Clients who are *actually using the player* —
// hours of playback already racked up on the general catalogue. The pitch
// shifts from "you might want this" to "you already use this hard, get the
// version tuned to your customer."
//
// LIFECYCLE-class email: opt-out gated, unsub footer attached by the renderer.

import { layout, button } from './_layout.js'

export interface EngagedFreeToCoreProps {
  upgradeUrl: string
  songsPlayed: number
}

export function subject(_props: EngagedFreeToCoreProps): string {
  return 'You’re putting hundreds of songs through your floor a week'
}

export function html(props: EngagedFreeToCoreProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">${props.songsPlayed.toLocaleString()} songs through your store on Essentials.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;re using the player. The music is doing real work for you on the catalogue every store starts on.</p>
    <p style="margin:0 0 14px 0;">On Core, the same hours of playback hit a library built around your specific customer. Same staff, same hours, sharper match.</p>
    ${button(props.upgradeUrl, 'Unlock Core')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Seven questions, two minutes of intake, and the library retunes around the answers.</p>
  `
  return layout({ preheader: 'Same playback, sharper library on Core.', body })
}
