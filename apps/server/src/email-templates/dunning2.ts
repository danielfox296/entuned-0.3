// Dunning — second notice. Direct; player is at risk.
// DB-editable via the admin Email panel; this file is the TS fallback.

import { layout, button } from './_layout.js'

export interface Dunning2Props {
  billingPortalUrl: string
}

export function subject(_props: Dunning2Props): string {
  return 'Second notice: payment failed'
}

export function html(props: Dunning2Props): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Second attempt failed.</p>
    <p style="margin:0 0 14px 0;">One more retry in 3 days. After that, the player stops streaming until we collect. Update your card to avoid an interruption.</p>
    ${button(props.billingPortalUrl, 'Update billing')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Billing questions: founder@entuned.co.</p>
  `
  return layout({ preheader: 'Update your billing to avoid an interruption.', body })
}
