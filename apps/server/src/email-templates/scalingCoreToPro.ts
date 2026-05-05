// Behavioral upgrade trigger — Core → Pro, "scaling" signal.
//
// Fires for Core Clients who run 2+ paid locations. The signal is unambiguous
// — they're scaling, and Pro's per-location features (day-parting, POS
// integrations) start mattering economically once you can't eyeball every store.
//
// LIFECYCLE-class email: opt-out gated, unsub footer attached by the renderer.

import { layout, button } from './_layout.js'

export interface ScalingCoreToProProps {
  upgradeUrl: string
  storeCount: number
}

export function subject(_props: ScalingCoreToProProps): string {
  return 'You run multiple locations now. Pro is when you stop running them blind.'
}

export function html(props: ScalingCoreToProProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">${props.storeCount} locations on Core.</p>
    <p style="margin:0 0 14px 0;">At one location, eyeballing the floor works. At ${props.storeCount}, it doesn&rsquo;t. You can&rsquo;t hear what every store is hearing, and you can&rsquo;t tell which hours need different music.</p>
    <p style="margin:0 0 14px 0;">Pro adds two things that pay for themselves at scale:</p>
    <ul style="margin:0 0 14px 0;padding-left:20px;">
      <li style="margin-bottom:6px;"><strong style="color:#d7af74;">Day-parting</strong> &mdash; outcome rotation per location. Morning lull on Increase Dwell, Saturday afternoon on Infuse Energy. One rule, every store.</li>
      <li><strong style="color:#d7af74;">POS integrations</strong> &mdash; Square / Shopify / Lightspeed. Music outcomes next to hourly transactions, per location. Stop guessing which mix moved.</li>
    </ul>
    ${button(props.upgradeUrl, 'Upgrade to Pro')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">$399 per location, per month. The math works once you can prove the lift.</p>
  `
  return layout({ preheader: `${props.storeCount} locations on Core. Pro is the next gear.`, body })
}
