// PRO licensing certificate delivery.
//
// PRO = Performance Rights Organization (ASCAP / BMI / SESAC) — the
// music-rights licensing umbrella, NOT the Pro subscription tier. Every
// Entuned plan is PRO-indemnified from day one (per pricing.html SSOT).
//
// Template name kept as `indemnificationCert` to avoid an out-of-band
// rename to the EmailTemplate.name DB key + every callsite — the user-
// facing copy is what matters and that all says "PRO licensing certificate."

import { layout, button, escape } from './_layout.js'

export interface IndemnificationCertProps {
  accountId: string
  pdfUrl: string
}

export function subject(_props: IndemnificationCertProps): string {
  return 'Your Entuned PRO licensing certificate'
}

export function html(props: IndemnificationCertProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your PRO licensing certificate is ready.</p>
    <p style="margin:0 0 14px 0;">Proof of music-rights coverage (ASCAP / BMI / SESAC) for the music in your store. Keep a copy with your licensing records &mdash; landlords and franchisors typically ask for it.</p>
    ${button(props.pdfUrl, 'Download PDF')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Account ID: <span style="color:#E8E4DE;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escape(props.accountId)}</span></p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#9a958c;">Audit copy is also stored in your dashboard under Documents.</p>
  `
  return layout({ preheader: 'PRO licensing certificate attached.', body })
}
