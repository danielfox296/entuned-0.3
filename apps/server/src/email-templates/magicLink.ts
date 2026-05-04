// Magic-link sign-in email.
//
// Sent when a customer requests passwordless login to the dashboard.
// Single CTA, short copy, expiry note. No marketing.

import { layout, button, escape } from './_layout.js'

export interface MagicLinkProps {
  link: string
}

export function subject(_props: MagicLinkProps): string {
  return 'Your Entuned sign-in link'
}

export function html(props: MagicLinkProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Sign in to Entuned</p>
    <p style="margin:0 0 18px 0;">Click the button below to sign in. The link expires in 15 minutes and works once.</p>
    ${button(props.link, 'Sign in')}
    <p style="margin:18px 0 0 0;font-size:12px;color:#9a958c;">If the button doesn&rsquo;t work, paste this URL into your browser:</p>
    <p style="margin:6px 0 0 0;font-size:12px;color:#9a958c;word-break:break-all;">${escape(props.link)}</p>
    <p style="margin:22px 0 0 0;font-size:12px;color:#9a958c;">If you didn&rsquo;t request this, ignore the email. No account changes will occur.</p>
  `
  return layout({ preheader: 'One-time sign-in link, expires in 15 minutes.', body })
}
