// Behavioral upgrade trigger — Core → Pro, "established" signal.
//
// Fires for Core Clients who have completed Brand Intake AND have been on
// Core for ≥30 days. The signal: they engaged with the product (filled the
// ICP) and stuck around (paid for a month). Pro's flagship pitch is that the
// data starts paying off — Lift Reports, integrations, day-parting.
//
// LIFECYCLE-class email: opt-out gated, unsub footer attached by the renderer.

import { layout, button } from './_layout.js'

export interface EstablishedCoreToProProps {
  upgradeUrl: string
}

export function subject(_props: EstablishedCoreToProProps): string {
  return 'A month of Core. Pro is where the data starts paying off.'
}

export function html(props: EstablishedCoreToProProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">A month of Core, and you finished intake.</p>
    <p style="margin:0 0 14px 0;">The library is built around your customer. The next question is whether the music is moving the number you actually care about.</p>
    <p style="margin:0 0 14px 0;">Pro is where you find out:</p>
    <ul style="margin:0 0 14px 0;padding-left:20px;">
      <li style="margin-bottom:6px;"><strong style="color:#d7af74;">Lift Reports</strong> &mdash; the music outcome on each shift, mapped to your existing CFO report. Forward it as-is.</li>
      <li style="margin-bottom:6px;"><strong style="color:#d7af74;">POS integrations</strong> &mdash; hourly sales next to what was playing. The lift stops being a story and starts being a line item.</li>
      <li><strong style="color:#d7af74;">Day-parting</strong> &mdash; different outcomes by hour. Match the customer that walks in at 11am vs. 5pm.</li>
    </ul>
    ${button(props.upgradeUrl, 'Unlock Pro')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">$399 per location, per month. The first time you forward a Lift Report to your CFO, it pays.</p>
  `
  return layout({ preheader: 'A month of Core. Pro is where the data starts paying off.', body })
}
