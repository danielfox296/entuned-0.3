// Dunning — final notice. Service pauses today.
// DB-editable via the admin Email panel; this file is the TS fallback.

import { layout, button } from './_layout.js'

export interface Dunning3Props {
  billingPortalUrl: string
}

export function subject(_props: Dunning3Props): string {
  return 'Final notice: service will pause today'
}

export function html(props: Dunning3Props): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Final notice.</p>
    <p style="margin:0 0 14px 0;">Service pauses end of day unless billing is current. Your library and Customer Profile stay intact &mdash; resume any time by updating your card.</p>
    ${button(props.billingPortalUrl, 'Update billing now')}
  `
  return layout({ preheader: 'Update your billing to avoid an interruption.', body })
}
