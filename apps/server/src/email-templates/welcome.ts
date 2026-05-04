// Welcome email — sent after a customer activates a paid plan.
//
// Tone: operator-direct. Tells them exactly what to do next, in order.
// Tier shapes the copy slightly (Pro gets a line about the human review pass).

import { layout, button, escape } from './_layout.js'

export type Tier = 'free' | 'essentials' | 'core' | 'pro'

export interface WelcomeProps {
  tier: Tier
  playerUrl: string
  dashboardUrl: string
}

const TIER_LABEL: Record<Tier, string> = {
  free: 'Essentials',
  essentials: 'Essentials',
  core: 'Core',
  pro: 'Pro',
}

export function subject(props: WelcomeProps): string {
  return `Welcome to Entuned ${TIER_LABEL[props.tier]}`
}

export function html(props: WelcomeProps): string {
  const tier = TIER_LABEL[props.tier]
  const isFree = props.tier === 'free' || props.tier === 'essentials'
  const proLine = props.tier === 'pro'
    ? `<p style="margin:0 0 14px 0;">Pro includes a human review pass on your first catalogue. Expect a note from us within 48 hours after your store profile is in.</p>`
    : ''
  const upgradeLine = isFree
    ? `<p style="margin:18px 0 0 0;font-size:14px;">Ready for music tailored to your specific customer? <a href="https://entuned.co/pricing.html" style="color:#d7af74;">Upgrade to Core</a> for a custom catalogue built around your ICP.</p>`
    : ''

  const dashboardCopy = isFree
    ? 'manage your account and add a location.'
    : 'finish your store profile so we can build the catalogue.'
  const playerCopy = isFree
    ? 'open this on the in-store device to start playing the general catalogue.'
    : 'sign in on the in-store device once your catalogue is ready.'

  const body = `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on ${escape(tier)}.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; ${dashboardCopy}</p>
    ${button(props.dashboardUrl, 'Open dashboard')}
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; ${playerCopy}</p>
    ${button(props.playerUrl, 'Open player')}
    ${proLine}
    ${upgradeLine}
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions go to founder@entuned.co. Replies hit a real person.</p>
  `
  return layout({ preheader: `Your ${tier} account is active. Two next steps inside.`, body })
}
