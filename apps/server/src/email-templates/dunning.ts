// Dunning sequence — three escalating notices for failed payments.
//
//   1. Heads-up. We&rsquo;ll retry. No tone shift.
//   2. Direct. Player is at risk if we can&rsquo;t collect.
//   3. Final. Service pauses unless billing is updated today.

import { layout, button } from './_layout.js'

export type DunningAttempt = 1 | 2 | 3

export interface DunningProps {
  attempt: DunningAttempt
  billingPortalUrl: string
}

export function subject(props: DunningProps): string {
  switch (props.attempt) {
    case 1: return 'Payment didn&rsquo;t go through'
    case 2: return 'Second notice: payment failed'
    case 3: return 'Final notice: service will pause today'
  }
}

export function html(props: DunningProps): string {
  let headline: string
  let copy: string
  let cta: string

  switch (props.attempt) {
    case 1:
      headline = 'A payment didn&rsquo;t clear.'
      copy = 'We&rsquo;ll retry in 3 days. If your card has changed, update it now and we&rsquo;ll re-bill immediately.'
      cta = 'Update billing'
      break
    case 2:
      headline = 'Second attempt failed.'
      copy = 'One more retry in 3 days. After that, the player stops streaming until we collect. Update your card to avoid an interruption.'
      cta = 'Update billing'
      break
    case 3:
      headline = 'Final notice.'
      copy = 'Service pauses end of day unless billing is current. Catalogue and store profile stay intact &mdash; resume any time by updating your card.'
      cta = 'Update billing now'
      break
  }

  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">${headline}</p>
    <p style="margin:0 0 14px 0;">${copy}</p>
    ${button(props.billingPortalUrl, cta)}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Billing questions: founder@entuned.co.</p>
  `
  return layout({ preheader: 'Update your billing to avoid an interruption.', body })
}
