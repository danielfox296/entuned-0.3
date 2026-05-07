// Seed bodies for the DB-editable email templates.
//
// Each entry is the operator-editable body fragment (raw HTML, with
// Mustache-style `{{var}}` placeholders). At render time the body is
// interpolated against props and wrapped in `_layout.layout`.
//
// Every template in the registry that maps to a single coherent body lives
// here. Variant routing happens upstream (e.g. sendWelcome routes by tier
// to welcomeFree / welcomeCore / welcomePro), so each row in this file is a
// flat, branchless body the operator can edit.

import type { TemplateName } from './index.js'

export interface TemplateSeed {
  subject: string
  body: string
  preheader: string
  propsExample: Record<string, unknown>
}

export const EDITABLE_TEMPLATES: Partial<Record<TemplateName, TemplateSeed>> = {
  magicLink: {
    subject: 'Your Entuned sign-in link',
    preheader: 'One-time sign-in link, expires in 15 minutes.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Sign in to Entuned</p>
    <p style="margin:0 0 18px 0;">Click the button below to sign in. The link expires in 15 minutes and works once.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{link}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Sign in</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:12px;color:#9a958c;">If the button doesn&rsquo;t work, paste this URL into your browser:</p>
    <p style="margin:6px 0 0 0;font-size:12px;color:#9a958c;word-break:break-all;">{{link}}</p>
    <p style="margin:22px 0 0 0;font-size:12px;color:#9a958c;">If you didn&rsquo;t request this, ignore the email. No account changes will occur.</p>
    `.trim(),
    propsExample: { link: 'https://api.entuned.co/login/verify?token=sample' },
  },
  welcomeFree: {
    subject: 'Welcome to Entuned Free',
    preheader: 'Open the player on the device that drives your shop speakers. Pick an outcome. Music starts.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on Entuned Free.</p>
    <p style="margin:0 0 14px 0;"><strong style="color:#d7af74;">Start here:</strong> open the player on whatever device drives your shop&rsquo;s speakers (the laptop behind the counter, an iPad, a Bluetooth-paired phone). Pick Linger or Lift Energy. Music starts.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open player</a></td></tr></table>
    <p style="margin:22px 0 6px 0;font-size:14px;color:#9a958c;">When you have a minute &mdash; the dashboard is where you manage your account, add another location, or upgrade.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:14px;">Ready for music tuned to your specific customer? <a href="https://entuned.co/pricing.html" style="color:#d7af74;">Unlock Core</a> for a private library built around the people who actually walk into your store.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Replies hit a real person.</p>
    `.trim(),
    propsExample: {
      playerUrl: 'https://music.entuned.co/sample-store-1234',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  welcomeCore: {
    subject: 'Welcome to Entuned Core',
    preheader: 'Your Core account is active. Two next steps inside.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on Core.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; fill out Customer Profile so we can build a library around your customer.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; sign in on the in-store device once your library is ready.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open player</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Replies hit a real person.</p>
    `.trim(),
    propsExample: {
      playerUrl: 'https://music.entuned.co/sample-store-1234',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  welcomePro: {
    subject: 'Welcome to Entuned Pro',
    preheader: 'Your Pro account is active. Two next steps inside.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on Pro.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; fill out Customer Profile so we can build a library around your customer.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; sign in on the in-store device once your library is ready.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open player</a></td></tr></table>
    <p style="margin:14px 0 0 0;">Pro includes a human review pass on your first library. Expect a note from us within 48 hours after Customer Profile is in.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Replies hit a real person.</p>
    `.trim(),
    propsExample: {
      playerUrl: 'https://music.entuned.co/sample-store-1234',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  catalogueReady: {
    subject: 'Your catalogue is ready',
    preheader: 'First catalogue is live. Preview before it hits the floor.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your first library is live.</p>
    <p style="margin:0 0 14px 0;">Built around your customer and ready to play. Preview tracks in the dashboard before they hit the floor.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Preview in dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">If anything feels off &mdash; tempo, energy, era &mdash; flag it. We re-tune fast.</p>
    `.trim(),
    propsExample: { dashboardUrl: 'https://app.entuned.co' },
  },
  dunning1: {
    subject: 'Payment didn’t go through',
    preheader: 'Update your billing to avoid an interruption.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">A payment didn&rsquo;t clear.</p>
    <p style="margin:0 0 14px 0;">We&rsquo;ll retry in 3 days. If your card has changed, update it now and we&rsquo;ll re-bill immediately.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{billingPortalUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Update billing</a></td></tr></table>
    `.trim(),
    propsExample: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  },
  dunning2: {
    subject: 'Second notice: payment failed',
    preheader: 'Update your billing to avoid an interruption.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Second attempt failed.</p>
    <p style="margin:0 0 14px 0;">One more retry in 3 days. After that, the player stops streaming until we collect. Update your card to avoid an interruption.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{billingPortalUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Update billing</a></td></tr></table>
    `.trim(),
    propsExample: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  },
  dunning3: {
    subject: 'Final notice: service will pause today',
    preheader: 'Update your billing to avoid an interruption.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Final notice.</p>
    <p style="margin:0 0 14px 0;">Service pauses end of day unless billing is current. Your library and Customer Profile stay intact &mdash; resume any time by updating your card.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{billingPortalUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Update billing now</a></td></tr></table>
    `.trim(),
    propsExample: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  },
  pauseEnding: {
    subject: 'Your pause ends in {{daysRemaining}} days',
    preheader: 'Service auto-resumes soon.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your pause ends in {{daysRemaining}} days.</p>
    <p style="margin:0 0 14px 0;">Billing and streaming resume automatically. If you need more time off &mdash; or want to cancel &mdash; do it from the dashboard before then.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Manage pause</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">No action means resume as planned.</p>
    `.trim(),
    propsExample: { daysRemaining: 7, dashboardUrl: 'https://app.entuned.co' },
  },
  indemnificationCert: {
    subject: 'Your Entuned PRO licensing certificate',
    preheader: 'PRO licensing certificate attached.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your PRO licensing certificate is ready.</p>
    <p style="margin:0 0 14px 0;">Proof of music-rights coverage (ASCAP / BMI / SESAC) for the music in your store. Keep a copy with your licensing records &mdash; landlords and franchisors typically ask for it.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{pdfUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Download PDF</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Account ID: <span style="color:#E8E4DE;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">{{accountId}}</span></p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#9a958c;">Audit copy is also stored in your dashboard under Documents.</p>
    `.trim(),
    propsExample: {
      accountId: '00000000-0000-0000-0000-000000000000',
      pdfUrl: 'https://app.entuned.co/cert/sample.pdf',
    },
  },
  icpUnfilled: {
    subject: 'Two minutes to a library built around your customer',
    preheader: 'Customer Profile tunes the library to your audience. Two minutes.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Two minutes to a library built around your customer.</p>
    <p style="margin:0 0 14px 0;">Your Core account can be tuned to the people who actually walk into your store. The seven Customer Profile questions are what we tune it from &mdash; about who they are, what they value, what would make them leave.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{intakeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Set up Customer Profile</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Fill it once and we get out of the way &mdash; you can come back and re-tune any time.</p>
    `.trim(),
    propsExample: { intakeUrl: 'https://app.entuned.co/intake' },
  },
  freeToCoreNudge: {
    subject: 'Music tuned to who actually walks into your store',
    preheader: 'A library built around your customer. $99 / location / month.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">On Core, your library is built around your customer.</p>
    <p style="margin:0 0 14px 0;">Entuned Free gives you a soundtrack engineered for retail in general &mdash; Linger or Lift Energy on a 100+ song catalogue. It&rsquo;s the same one every store starts on.</p>
    <p style="margin:0 0 14px 0;">On Core, you answer seven questions about who walks in and we build a private library around them. All research-backed outcomes unlocked. $99 per location, per month. No setup fee, no contracts, cancel any time.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Unlock Core</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#9a958c;">Your current player: <a href="{{playerUrl}}" style="color:#d7af74;">{{playerUrl}}</a></p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
      playerUrl: 'https://music.entuned.co/sample-store-1234',
    },
  },
  engagedFreeToCore: {
    subject: 'You&rsquo;re putting hundreds of songs through your floor a week',
    preheader: 'Same playback, sharper library on Core.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">{{songsPlayed}} songs through your store on Entuned Free.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;re using the player. The music is doing real work for you on the catalogue every store starts on.</p>
    <p style="margin:0 0 14px 0;">On Core, the same hours of playback hit a library built around your specific customer. Same staff, same hours, sharper match.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Unlock Core</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Seven questions, two minutes of intake, and the library retunes around the answers.</p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
      songsPlayed: 247,
    },
  },
  scalingCoreToPro: {
    subject: 'You run multiple locations now. Pro is the next gear.',
    preheader: '{{storeCount}} locations on Core. Pro is the next gear.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">{{storeCount}} locations on Core.</p>
    <p style="margin:0 0 14px 0;">At one location, you can hear the floor. At {{storeCount}}, you can&rsquo;t be everywhere &mdash; and you can&rsquo;t tell which hours need different music.</p>
    <p style="margin:0 0 14px 0;">Pro adds two things that pay for themselves at scale:</p>
    <ul style="margin:0 0 14px 0;padding-left:20px;">
      <li style="margin-bottom:6px;"><strong style="color:#d7af74;">Day-parting</strong> &mdash; outcome rotation per location. Morning lull on Linger, Saturday afternoon on Lift Energy. One rule, every store.</li>
      <li><strong style="color:#d7af74;">POS integrations</strong> &mdash; Square / Shopify / Lightspeed. Music outcomes next to hourly transactions, per location. The lift stops being a story and starts being a line item.</li>
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Unlock Pro</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">$399 per location, per month. The math works once you can prove the lift.</p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=pro',
      storeCount: 3,
    },
  },
  establishedCoreToPro: {
    subject: 'A month of Core. Pro is where the data starts paying off.',
    preheader: 'A month of Core. Pro is where the data starts paying off.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">A month of Core, and you finished intake.</p>
    <p style="margin:0 0 14px 0;">The library is built around your customer. The next question is whether the music is moving the number you actually care about.</p>
    <p style="margin:0 0 14px 0;">Pro is where you find out:</p>
    <ul style="margin:0 0 14px 0;padding-left:20px;">
      <li style="margin-bottom:6px;"><strong style="color:#d7af74;">Lift Reports</strong> &mdash; the music outcome on each shift, mapped to your existing CFO report. Forward it as-is.</li>
      <li style="margin-bottom:6px;"><strong style="color:#d7af74;">POS integrations</strong> &mdash; hourly sales next to what was playing. The lift stops being a story and starts being a line item.</li>
      <li><strong style="color:#d7af74;">Day-parting</strong> &mdash; different outcomes by hour. Match the customer that walks in at 11am vs. 5pm.</li>
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Unlock Pro</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">$399 per location, per month. The first time you forward a Lift Report to your CFO, it pays.</p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=pro',
    },
  },
  compEnding: {
    subject: 'Your free {{effectiveTier}} upgrade ends {{endsOn}}',
    preheader: 'Your {{effectiveTier}} upgrade ends in {{daysRemaining}} day(s).',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">A heads-up: your {{effectiveTier}} upgrade ends in {{daysRemaining}} day(s).</p>
    <p style="margin:0 0 14px 0;">You&rsquo;ve been on {{effectiveTier}} as a comp from us. That ends on <strong style="color:#E8E4DE;">{{endsOn}}</strong>.</p>
    <p style="margin:0 0 14px 0;">Two options:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">Keep {{effectiveTier}}.</strong> One click and the upgrade becomes a real subscription change &mdash; we&rsquo;ll handle the proration.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Keep {{effectiveTier}}</a></td></tr></table>
    <p style="margin:18px 0 6px 0;"><strong style="color:#d7af74;">Stay on {{paidTier}}.</strong> Do nothing &mdash; nothing about your billing changes.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions? Reply to this email &mdash; it goes to a real person.</p>
    `.trim(),
    propsExample: {
      effectiveTier: 'pro',
      paidTier: 'core',
      daysRemaining: 7,
      endsOn: 'Aug 12, 2026',
      upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  compEnded: {
    subject: 'Your {{formerCompTier}} upgrade ended — pick up where you left off?',
    preheader: 'Your {{formerCompTier}} upgrade ended. One click brings it back.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your {{formerCompTier}} upgrade just ended.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;re back on {{paidTier}}. The {{formerCompTier}} features are off.</p>
    <p style="margin:0 0 14px 0;">If you want to keep {{formerCompTier}}, the upgrade is one click away. We&rsquo;ll prorate so you only pay from today.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Upgrade to {{formerCompTier}}</a></td></tr></table>
    <p style="margin:18px 0 0 0;">Or stay where you are &mdash; no further action needed.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions? Just reply.</p>
    `.trim(),
    propsExample: {
      formerCompTier: 'pro',
      paidTier: 'core',
      upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
}

export const EDITABLE_TEMPLATE_NAMES = Object.keys(EDITABLE_TEMPLATES) as TemplateName[]
