// Catalogue ready notification.
//
// Sent when a store's first catalogue finishes generation and is queued
// in the player. Customer can preview in the dashboard before going live.

import { layout, button } from './_layout.js'

export interface CatalogueReadyProps {
  dashboardUrl: string
}

export function subject(_props: CatalogueReadyProps): string {
  return 'Your catalogue is ready'
}

export function html(props: CatalogueReadyProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your first library is live.</p>
    <p style="margin:0 0 14px 0;">Built around your customer and ready to play. Preview tracks in the dashboard before they hit the floor.</p>
    ${button(props.dashboardUrl, 'Preview in dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">If anything feels off &mdash; tempo, energy, era &mdash; flag it. We re-tune fast.</p>
  `
  return layout({ preheader: 'First catalogue is live. Preview before it hits the floor.', body })
}
