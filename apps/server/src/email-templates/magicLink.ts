// Magic-link sign-in email.
//
// Two-link variant: primary CTA opens the player (music.entuned.co), secondary
// text link opens the dashboard (app.entuned.co). Both URLs carry the same
// one-shot token — whichever the user clicks first consumes it.
//
// `link` is kept as a back-compat alias used when only one destination matters
// (e.g. callers that pre-date the player-direct flow). When `playerLink` is
// supplied it overrides the primary CTA target.

import { layout, button, escape } from './_layout.js'

export interface MagicLinkProps {
  link: string
  playerLink?: string
}

export function subject(_props: MagicLinkProps): string {
  return 'Your Entuned sign-in link'
}

export function html(props: MagicLinkProps): string {
  const primary = props.playerLink ?? props.link
  const secondary = props.link
  const showSecondary = props.playerLink && props.playerLink !== props.link
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your music is ready</p>
    <p style="margin:0 0 18px 0;">Tap below to open your player. The link expires in 15 minutes and works once.</p>
    ${button(primary, 'Open Your Player')}
    ${showSecondary ? `<p style="margin:18px 0 0 0;font-size:13px;"><a href="${escape(secondary)}" style="color:#8a929a;">Or manage your account &rarr;</a></p>` : ''}
    <p style="margin:18px 0 0 0;font-size:12px;color:#8a929a;">If the button doesn&rsquo;t work, paste this URL into your browser:</p>
    <p style="margin:6px 0 0 0;font-size:12px;color:#8a929a;word-break:break-all;">${escape(primary)}</p>
    <p style="margin:22px 0 0 0;font-size:12px;color:#8a929a;">If you didn&rsquo;t request this, ignore the email. No account changes will occur.</p>
  `
  return layout({ preheader: 'One-tap player link. Expires in 15 minutes.', body })
}
