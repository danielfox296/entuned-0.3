// Internal admin notification — fires once per new account on first sign-in
// (from lib/account.ts → ensureFreeClientForUser, after the welcome email).
//
// Recipient is the operator address in ADMIN_EMAIL. Transactional (not
// subject to lifecycle opt-out).

import { layout } from './_layout.js'

export interface AdminSignupNotificationProps {
  userEmail: string
  companyName: string
  playerUrl: string
  signedUpAt: string
}

export function subject(props: AdminSignupNotificationProps): string {
  return `New Entuned signup: ${props.userEmail}`
}

export function html(props: AdminSignupNotificationProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">New signup</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;font-size:14px;">
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">Email</td><td style="padding:2px 0;color:#d4e1e5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${props.userEmail}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">Company</td><td style="padding:2px 0;color:#d4e1e5;">${props.companyName}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">Player</td><td style="padding:2px 0;"><a href="${props.playerUrl}" style="color:#50929c;">${props.playerUrl}</a></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">When</td><td style="padding:2px 0;color:#d4e1e5;">${props.signedUpAt}</td></tr>
    </table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Free tier, welcome email already sent. Account is in Dash.</p>
  `
  return layout({ preheader: `New signup: ${props.userEmail}`, body })
}
