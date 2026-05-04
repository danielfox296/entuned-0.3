// Pause-ending reminder.
//
// Sent when a paused account is approaching auto-resume. Gives the customer
// time to extend the pause or cancel before billing restarts.

import { layout, button } from './_layout.js'

export interface PauseEndingProps {
  daysRemaining: number
  dashboardUrl: string
}

export function subject(props: PauseEndingProps): string {
  if (props.daysRemaining <= 0) return 'Your pause ends today'
  if (props.daysRemaining === 1) return 'Your pause ends tomorrow'
  return `Your pause ends in ${props.daysRemaining} days`
}

export function html(props: PauseEndingProps): string {
  const days = props.daysRemaining
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`

  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your pause ends ${when}.</p>
    <p style="margin:0 0 14px 0;">Billing and streaming resume automatically. If you need more time off &mdash; or want to cancel &mdash; do it from the dashboard before then.</p>
    ${button(props.dashboardUrl, 'Manage pause')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">No action means resume as planned.</p>
  `
  return layout({ preheader: `Service auto-resumes ${when}.`, body })
}
