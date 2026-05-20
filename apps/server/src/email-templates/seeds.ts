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
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Sign in to Entuned</p>
    <p style="margin:0 0 18px 0;">Click the button below to sign in. The link expires in 15 minutes and works once.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{link}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Sign in</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:12px;color:#8a929a;">If the button doesn&rsquo;t work, paste this URL into your browser:</p>
    <p style="margin:6px 0 0 0;font-size:12px;color:#8a929a;word-break:break-all;">{{link}}</p>
    <p style="margin:22px 0 0 0;font-size:12px;color:#8a929a;">If you didn&rsquo;t request this, ignore the email. No account changes will occur.</p>
    `.trim(),
    propsExample: { link: 'https://api.entuned.co/login/verify?token=sample' },
  },
  welcomeFree: {
    subject: 'Welcome to Entuned Free',
    preheader: 'Open the player on the device that drives your shop speakers. Pick an outcome. Music starts.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">You&rsquo;re on Entuned Free.</p>
    <p style="margin:0 0 14px 0;"><strong style="color:#50929c;">Start here:</strong> open the player on whatever device drives your shop&rsquo;s speakers (the laptop behind the counter, an iPad, a Bluetooth-paired phone). Pick Linger or Lift Energy. Music starts.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open player</a></td></tr></table>
    <p style="margin:22px 0 6px 0;font-size:14px;color:#8a929a;">When you have a minute &mdash; the dashboard is where you manage your account, add another location, or upgrade.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:14px;">Ready for music tuned to your specific customer? <a href="https://entuned.co/pricing.html" style="color:#50929c;">Unlock Boost</a> for a private library built around the people who actually walk into your store.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Replies hit a real person.</p>
    `.trim(),
    propsExample: {
      playerUrl: 'https://music.entuned.co/sample-store-1234',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  welcomeCore: {
    subject: 'Welcome to Entuned Boost',
    preheader: 'Your Boost account is active. Two next steps inside.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">You&rsquo;re on Boost.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#50929c;">1. Dashboard</strong> &mdash; fill out Customer Profile so we can build a library around your customer.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:14px 0 6px 0;"><strong style="color:#50929c;">2. Player</strong> &mdash; sign in on the in-store device once your library is ready.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open player</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Replies hit a real person.</p>
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
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">You&rsquo;re on Pro.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#50929c;">1. Dashboard</strong> &mdash; fill out Customer Profile so we can build a library around your customer.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:14px 0 6px 0;"><strong style="color:#50929c;">2. Player</strong> &mdash; sign in on the in-store device once your library is ready.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open player</a></td></tr></table>
    <p style="margin:14px 0 0 0;">Pro includes a human review pass on your first library. Expect a note from us within 48 hours after Customer Profile is in.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Replies hit a real person.</p>
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
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your first library is live.</p>
    <p style="margin:0 0 14px 0;">Built around your customer and ready to play. Preview tracks in the dashboard before they hit the floor.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Preview in dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">If anything feels off &mdash; tempo, energy, era &mdash; flag it. We re-tune fast.</p>
    `.trim(),
    propsExample: { dashboardUrl: 'https://app.entuned.co' },
  },
  dunning1: {
    subject: 'Payment didn’t go through',
    preheader: 'Update your billing to avoid an interruption.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">A payment didn&rsquo;t clear.</p>
    <p style="margin:0 0 14px 0;">We&rsquo;ll retry in 3 days. If your card has changed, update it now and we&rsquo;ll re-bill immediately.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{billingPortalUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Update billing</a></td></tr></table>
    `.trim(),
    propsExample: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  },
  dunning2: {
    subject: 'Second notice: payment failed',
    preheader: 'Update your billing to avoid an interruption.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Second attempt failed.</p>
    <p style="margin:0 0 14px 0;">One more retry in 3 days. After that, the player stops streaming until we collect. Update your card to avoid an interruption.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{billingPortalUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Update billing</a></td></tr></table>
    `.trim(),
    propsExample: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  },
  dunning3: {
    subject: 'Final notice: service will pause today',
    preheader: 'Update your billing to avoid an interruption.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Final notice.</p>
    <p style="margin:0 0 14px 0;">Service pauses end of day unless billing is current. Your library and Customer Profile stay intact &mdash; resume any time by updating your card.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{billingPortalUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Update billing now</a></td></tr></table>
    `.trim(),
    propsExample: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  },
  pauseEnding: {
    subject: 'Your pause ends in {{daysRemaining}} days',
    preheader: 'Service auto-resumes soon.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your pause ends in {{daysRemaining}} days.</p>
    <p style="margin:0 0 14px 0;">Billing and streaming resume automatically. If you need more time off &mdash; or want to cancel &mdash; do it from the dashboard before then.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Manage pause</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">No action means resume as planned.</p>
    `.trim(),
    propsExample: { daysRemaining: 7, dashboardUrl: 'https://app.entuned.co' },
  },
  indemnificationCert: {
    subject: 'Your Entuned PRO licensing certificate',
    preheader: 'PRO licensing certificate attached.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your PRO licensing certificate is ready.</p>
    <p style="margin:0 0 14px 0;">Proof of music-rights coverage (ASCAP / BMI / SESAC) for the music in your store. Keep a copy with your licensing records &mdash; landlords and franchisors typically ask for it.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{pdfUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Download PDF</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Account ID: <span style="color:#d4e1e5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">{{accountId}}</span></p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#8a929a;">Audit copy is also stored in your dashboard under Documents.</p>
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
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Two minutes to a library built around your customer.</p>
    <p style="margin:0 0 14px 0;">Your Boost account can be tuned to the people who actually walk into your store. The seven Customer Profile questions are what we tune it from &mdash; about who they are, what they value, what would make them leave.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{intakeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Set up Customer Profile</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Fill it once and we get out of the way &mdash; you can come back and re-tune any time.</p>
    `.trim(),
    propsExample: { intakeUrl: 'https://app.entuned.co/intake' },
  },
  freeToCoreNudge: {
    subject: 'Music tuned to who actually walks into your store',
    preheader: 'A library built around your customer. $99 / location / month.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">On Boost, your library is built around your customer.</p>
    <p style="margin:0 0 14px 0;">Entuned Free gives you a soundtrack engineered for retail in general &mdash; Linger or Lift Energy on a 100+ song catalogue. It&rsquo;s the same one every store starts on.</p>
    <p style="margin:0 0 14px 0;">On Boost, you answer seven questions about who walks in and we build a private library around them. All research-backed outcomes unlocked. $99 per location, per month. No setup fee, no contracts, cancel any time.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Unlock Boost</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Your current player: <a href="{{playerUrl}}" style="color:#50929c;">{{playerUrl}}</a></p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
      playerUrl: 'https://music.entuned.co/sample-store-1234',
    },
  },
  engagedFreeToCore: {
    subject: 'You&rsquo;re putting hundreds of songs through your floor a week',
    preheader: 'Same playback, sharper library on Boost.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">{{songsPlayed}} songs through your store on Entuned Free.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;re using the player. The music is doing real work for you on the catalogue every store starts on.</p>
    <p style="margin:0 0 14px 0;">On Boost, the same hours of playback hit a library built around your specific customer. Same staff, same hours, sharper match.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Unlock Boost</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Seven questions, two minutes of intake, and the library retunes around the answers.</p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
      songsPlayed: 247,
    },
  },
  scalingCoreToPro: {
    subject: 'You run multiple locations now. Pro is the next gear.',
    preheader: '{{storeCount}} locations on Boost. Pro is the next gear.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">{{storeCount}} locations on Boost.</p>
    <p style="margin:0 0 14px 0;">At one location, you can hear the floor. At {{storeCount}}, you can&rsquo;t be everywhere &mdash; and you can&rsquo;t tell which hours need different music.</p>
    <p style="margin:0 0 14px 0;">Pro adds two things that pay for themselves at scale:</p>
    <ul style="margin:0 0 14px 0;padding-left:20px;">
      <li style="margin-bottom:6px;"><strong style="color:#50929c;">Outcome Scheduling</strong> &mdash; outcome rotation per location. Morning lull on Linger, Saturday afternoon on Lift Energy. One rule, every store.</li>
      <li><strong style="color:#50929c;">POS integrations</strong> &mdash; Square / Shopify / Lightspeed. Music outcomes next to hourly transactions, per location. The lift stops being a story and starts being a line item.</li>
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Unlock Pro</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">$399 per location, per month. The math works once you can prove the lift.</p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=pro',
      storeCount: 3,
    },
  },
  establishedCoreToPro: {
    subject: 'A month of Boost. Pro is where the data starts paying off.',
    preheader: 'A month of Boost. Pro is where the data starts paying off.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">A month of Boost, and you finished intake.</p>
    <p style="margin:0 0 14px 0;">The library is built around your customer. The next question is whether the music is moving the number you actually care about.</p>
    <p style="margin:0 0 14px 0;">Pro is where you find out:</p>
    <ul style="margin:0 0 14px 0;padding-left:20px;">
      <li style="margin-bottom:6px;"><strong style="color:#50929c;">Lift Reports</strong> &mdash; the music outcome on each shift, mapped to your existing CFO report. Forward it as-is.</li>
      <li style="margin-bottom:6px;"><strong style="color:#50929c;">POS integrations</strong> &mdash; hourly sales next to what was playing. The lift stops being a story and starts being a line item.</li>
      <li><strong style="color:#50929c;">Outcome Scheduling</strong> &mdash; different outcomes by hour. Match the customer that walks in at 11am vs. 5pm.</li>
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Unlock Pro</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">$399 per location, per month. The first time you forward a Lift Report to your CFO, it pays.</p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=pro',
    },
  },
  compEnding: {
    subject: 'Your free {{effectiveTier}} upgrade ends {{endsOn}}',
    preheader: 'Your {{effectiveTier}} upgrade ends in {{daysRemaining}} day(s).',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">A heads-up: your {{effectiveTier}} upgrade ends in {{daysRemaining}} day(s).</p>
    <p style="margin:0 0 14px 0;">You&rsquo;ve been on {{effectiveTier}} as a comp from us. That ends on <strong style="color:#d4e1e5;">{{endsOn}}</strong>.</p>
    <p style="margin:0 0 14px 0;">Two options:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#50929c;">Keep {{effectiveTier}}.</strong> One click and the upgrade becomes a real subscription change &mdash; we&rsquo;ll handle the proration.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Keep {{effectiveTier}}</a></td></tr></table>
    <p style="margin:18px 0 6px 0;"><strong style="color:#50929c;">Stay on {{paidTier}}.</strong> Do nothing &mdash; nothing about your billing changes.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Reply to this email &mdash; it goes to a real person.</p>
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
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your {{formerCompTier}} upgrade just ended.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;re back on {{paidTier}}. The {{formerCompTier}} features are off.</p>
    <p style="margin:0 0 14px 0;">If you want to keep {{formerCompTier}}, the upgrade is one click away. We&rsquo;ll prorate so you only pay from today.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Upgrade to {{formerCompTier}}</a></td></tr></table>
    <p style="margin:18px 0 0 0;">Or stay where you are &mdash; no further action needed.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
    `.trim(),
    propsExample: {
      formerCompTier: 'pro',
      paidTier: 'core',
      upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  boostTrialStreamReady: {
    subject: 'Your Boost library is generating',
    preheader: 'Your personalized library is being built. Open the player to hear it.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your Boost library is generating.</p>
    <p style="margin:0 0 14px 0;">We took your answers and started building. The first tracks built around your specific customer are on their way &mdash; you&rsquo;ll hear the difference in the first hour of playback.</p>
    <p style="margin:0 0 14px 0;">Open the player on whatever device drives your shop&rsquo;s speakers. Pick an outcome. The library plays.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open player</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Your trial: <strong style="color:#d4e1e5;">{{daysRemaining}} days</strong> of Boost, on us.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Reply here &mdash; it goes to a real person.</p>
    `.trim(),
    propsExample: {
      playerUrl: 'https://music.entuned.co/sample-store-1234',
      dashboardUrl: 'https://app.entuned.co',
      daysRemaining: 29,
    },
  },
  boostTrialEngagement: {
    subject: '{{daysRemaining}} days left on your Boost trial',
    preheader: '{{daysRemaining}} days left in your trial. Keep Boost for $99 / mo.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Two weeks in on Boost.</p>
    <p style="margin:0 0 14px 0;">The library built around your customer has been running for two weeks. You&rsquo;ve got <strong style="color:#d4e1e5;">{{daysRemaining}} days</strong> left in the trial.</p>
    <p style="margin:0 0 14px 0;">If it&rsquo;s been doing its job, locking it in is $99 per location per month &mdash; no setup fee, cancel any time.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Keep Boost &mdash; $99 / mo</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Not ready yet? Your trial keeps running.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
    `.trim(),
    propsExample: {
      daysRemaining: 16,
      upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  boostTrialEnding: {
    subject: 'Your Boost trial ends in {{daysRemaining}} days',
    preheader: '{{daysRemaining}} days left in your trial. Keep Boost for $99 / mo.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your Boost trial ends in {{daysRemaining}} days.</p>
    <p style="margin:0 0 14px 0;">After that, the personalized library stops and you&rsquo;re back on Entuned Free. Your customer profile stays saved.</p>
    <p style="margin:0 0 14px 0;">Lock in Boost for $99 per location per month &mdash; no contracts, cancel any time.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Keep Boost &mdash; $99 / mo</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">If you&rsquo;re not ready, no action needed &mdash; you&rsquo;ll drop back to Free when the trial ends.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
    `.trim(),
    propsExample: {
      daysRemaining: 5,
      upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  boostTrialExpired: {
    subject: 'Your Boost trial ended — keep it for $99 / mo',
    preheader: 'Your Boost trial ended. Upgrade to keep the personalized library running.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">Your Boost trial ended.</p>
    <p style="margin:0 0 14px 0;">You&rsquo;re back on Entuned Free. The personalized library is paused &mdash; your customer profile and all your settings are still saved.</p>
    <p style="margin:0 0 14px 0;">Upgrade to keep the library running. $99 per location per month, no contracts, cancel any time.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Upgrade to Boost</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">Or stay on Free &mdash; no further action needed. If you upgrade later, we pick up where you left off.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
  adminSignupNotification: {
    subject: 'New Entuned signup: {{userEmail}}',
    preheader: 'New signup: {{userEmail}}',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">New signup</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;font-size:14px;">
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">Email</td><td style="padding:2px 0;color:#d4e1e5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">{{userEmail}}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">Company</td><td style="padding:2px 0;color:#d4e1e5;">{{companyName}}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">Player</td><td style="padding:2px 0;"><a href="{{playerUrl}}" style="color:#50929c;">{{playerUrl}}</a></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8a929a;">When</td><td style="padding:2px 0;color:#d4e1e5;">{{signedUpAt}}</td></tr>
    </table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Free tier, welcome email already sent. Account is in Dash.</p>
    `.trim(),
    propsExample: {
      userEmail: 'newuser@example.com',
      companyName: 'newuser',
      playerUrl: 'https://music.entuned.co/sample-store-1234',
      signedUpAt: '2026-05-20 14:32 UTC',
    },
  },
  postConversionBenchmark: {
    subject: 'A week on Boost — want to track your lift?',
    preheader: 'Set a baseline. Track the lift. Two minutes.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#d4e1e5;">A week on Boost.</p>
    <p style="margin:0 0 14px 0;">The library has been running for a week. This is a good moment to set a baseline &mdash; if you tell us what your current numbers look like (dwell time, average transaction, conversion), we can surface any lift as it compounds.</p>
    <p style="margin:0 0 14px 0;">Takes about two minutes. Totally optional, but the operators who track it tend to keep Boost.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{benchmarkUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Set my baseline</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#8a929a;">You can also do this any time from the dashboard.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#50929c;border-radius:10px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#1a1a17;text-decoration:none;border-radius:10px;">Open dashboard</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8a929a;">Questions? Just reply.</p>
    `.trim(),
    propsExample: {
      benchmarkUrl: 'https://app.entuned.co/benchmark',
      dashboardUrl: 'https://app.entuned.co',
    },
  },
}

export const EDITABLE_TEMPLATE_NAMES = Object.keys(EDITABLE_TEMPLATES) as TemplateName[]
