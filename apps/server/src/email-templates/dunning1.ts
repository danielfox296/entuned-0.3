// Dunning — first notice. Heads-up tone; we'll retry.
// DB-editable via the admin Email panel; this file is the TS fallback.

import { layout, button } from './_layout.js'

export interface Dunning1Props {
  billingPortalUrl: string
}

export function subject(_props: Dunning1Props): string {
  return 'Payment didn’t go through'
}

export function html(props: Dunning1Props): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">A payment didn&rsquo;t clear.</p>
    <p style="margin:0 0 14px 0;">We&rsquo;ll retry in 3 days. If your card has changed, update it now and we&rsquo;ll re-bill immediately.</p>
    ${button(props.billingPortalUrl, 'Update billing')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Billing questions: founder@entuned.co.</p>
  `
  return layout({ preheader: 'Update your billing to avoid an interruption.', body })
}
