// Post-conversion benchmarking email.
//
// Fires ~7 days after a Boost Trial customer converts to a paid Core
// subscription (i.e., 7 days after the stripe_webhook TierChangeLog that
// followed a boost_trial_activated entry). Invites them to complete the
// benchmarking form so we can track measurable lift.
//
// LIFECYCLE-class: opt-out gated.

import { layout, button } from './_layout.js'

export interface PostConversionBenchmarkProps {
  benchmarkUrl: string
  dashboardUrl: string
}

export function subject(_props: PostConversionBenchmarkProps): string {
  return 'A week on Boost — want to track your lift?'
}

export function html(props: PostConversionBenchmarkProps): string {
  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">A week on Boost.</p>
    <p style="margin:0 0 14px 0;">The library has been running for a week. This is a good moment to set a baseline &mdash; if you tell us what your current numbers look like (dwell time, average transaction, conversion), we can surface any lift as it compounds.</p>
    <p style="margin:0 0 14px 0;">Takes about two minutes. Totally optional, but the operators who track it tend to keep Boost.</p>
    ${button(props.benchmarkUrl, 'Set my baseline')}
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">You can also do this any time from the dashboard.</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
  `
  return layout({ preheader: 'Set a baseline. Track the lift. Two minutes.', body })
}
