// Indemnification certificate delivery.
//
// Sent when a customer's IP indemnification cert (PDF) is generated.
// The cert covers commercial use of original music produced for their account.

import { layout, button, escape } from './_layout.js'

export interface IndemnificationCertProps {
  accountId: string
  pdfUrl: string
}

export function subject(_props: IndemnificationCertProps): string {
  return 'Your Entuned indemnification certificate'
}

export function html(props: IndemnificationCertProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your indemnification certificate is ready.</p>
    <p style="margin:0 0 14px 0;">Covers commercial use of the original music produced for your account. Keep a copy with your licensing records.</p>
    ${button(props.pdfUrl, 'Download PDF')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Account ID: <span style="color:#E8E4DE;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escape(props.accountId)}</span></p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#9a958c;">Audit copy is also stored in your dashboard under Documents.</p>
  `
  return layout({ preheader: 'IP indemnification certificate attached.', body })
}
