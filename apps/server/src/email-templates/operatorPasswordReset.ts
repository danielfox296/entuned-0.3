// Operator password-reset email.
//
// Sent when a Dash operator hits "Forgot password?". Single CTA, short copy,
// 60-minute expiry note. No marketing.

import { layout, button, escape } from './_layout.js'

export interface OperatorPasswordResetProps {
  link: string
}

export function subject(_props: OperatorPasswordResetProps): string {
  return 'Reset your Entuned admin password'
}

export function html(props: OperatorPasswordResetProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Reset your password</p>
    <p style="margin:0 0 18px 0;">We got a request to reset the password on your Entuned admin (Dash) account. Click below to set a new one. The link expires in 60 minutes and works once.</p>
    ${button(props.link, 'Set a new password')}
    <p style="margin:18px 0 0 0;font-size:12px;color:#8a929a;">If the button doesn&rsquo;t work, paste this URL into your browser:</p>
    <p style="margin:6px 0 0 0;font-size:12px;color:#8a929a;word-break:break-all;">${escape(props.link)}</p>
    <p style="margin:22px 0 0 0;font-size:12px;color:#8a929a;">If you didn&rsquo;t request this, ignore this email — your password stays the same.</p>
  `
  return layout({ preheader: 'Reset link, expires in 60 minutes.', body })
}
