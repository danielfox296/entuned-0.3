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
    subject: 'Welcome to Entuned Essentials',
    preheader: 'Your Essentials account is active. Two next steps inside.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You&rsquo;re on Essentials.</p>
    <p style="margin:0 0 14px 0;">Two links to get running:</p>
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; manage your account and add a location.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; open this on the in-store device to start playing the general catalogue.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open player</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:14px;">Ready for music tailored to your specific customer? <a href="https://entuned.co/pricing.html" style="color:#d7af74;">Upgrade to Core</a> for a custom catalogue built around your ICP.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions go to founder@entuned.co. Replies hit a real person.</p>
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
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; finish your store profile so we can build the catalogue.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; sign in on the in-store device once your catalogue is ready.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open player</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions go to founder@entuned.co. Replies hit a real person.</p>
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
    <p style="margin:0 0 6px 0;"><strong style="color:#d7af74;">1. Dashboard</strong> &mdash; finish your store profile so we can build the catalogue.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open dashboard</a></td></tr></table>
    <p style="margin:14px 0 6px 0;"><strong style="color:#d7af74;">2. Player</strong> &mdash; sign in on the in-store device once your catalogue is ready.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{playerUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open player</a></td></tr></table>
    <p style="margin:14px 0 0 0;">Pro includes a human review pass on your first catalogue. Expect a note from us within 48 hours after your store profile is in.</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Questions go to founder@entuned.co. Replies hit a real person.</p>
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
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your first catalogue is live.</p>
    <p style="margin:0 0 14px 0;">Built against your store profile and ready to play. Preview tracks in the dashboard before they hit the floor.</p>
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
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Billing questions: founder@entuned.co.</p>
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
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Billing questions: founder@entuned.co.</p>
    `.trim(),
    propsExample: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  },
  dunning3: {
    subject: 'Final notice: service will pause today',
    preheader: 'Update your billing to avoid an interruption.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Final notice.</p>
    <p style="margin:0 0 14px 0;">Service pauses end of day unless billing is current. Catalogue and store profile stay intact &mdash; resume any time by updating your card.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{billingPortalUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Update billing now</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">Billing questions: founder@entuned.co.</p>
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
    subject: 'Your Entuned indemnification certificate',
    preheader: 'IP indemnification certificate attached.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your indemnification certificate is ready.</p>
    <p style="margin:0 0 14px 0;">Covers commercial use of the original music produced for your account. Keep a copy with your licensing records.</p>
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
    subject: 'Two minutes to better music for your store',
    preheader: 'Brand Intake unlocks tailored music. Two minutes.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">You upgraded. We&rsquo;re still playing the average shopper.</p>
    <p style="margin:0 0 14px 0;">Until you fill out Brand Intake, your player runs on the general catalogue &mdash; the one tuned for nobody in particular. Seven questions, two minutes, and we shift the library to fit your specific customer.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{intakeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Open Brand Intake</a></td></tr></table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#9a958c;">If your customer really is "everyone" &mdash; ignore this. Otherwise, the music gets noticeably better the moment you tell us who walks in.</p>
    `.trim(),
    propsExample: { intakeUrl: 'https://app.entuned.co/intake' },
  },
  freeToCoreNudge: {
    subject: 'Music written for your customer, not the average shopper',
    preheader: 'Tailored music for your specific customer. $99/loc/mo.',
    body: `
    <p style="margin:0 0 14px 0;font-size:18px;font-weight:600;color:#E8E4DE;">Your store has its own taste. The general catalogue doesn&rsquo;t know that yet.</p>
    <p style="margin:0 0 14px 0;">On Essentials you&rsquo;re streaming the pool tuned for retail in general. It&rsquo;s good. It&rsquo;s not <em>yours</em>.</p>
    <p style="margin:0 0 14px 0;">On Core, you answer seven questions about who walks in, and we build a private library around them. $99 per location, per month. No setup fee, no contracts, cancel any time.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr><td style="background:#d7af74;"><a href="{{upgradeUrl}}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;">Upgrade to Core</a></td></tr></table>
    <p style="margin:18px 0 6px 0;font-size:13px;color:#9a958c;">Your current player: <a href="{{playerUrl}}" style="color:#d7af74;">{{playerUrl}}</a></p>
    `.trim(),
    propsExample: {
      upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
      playerUrl: 'https://music.entuned.co/sample-store-1234',
    },
  },
}

export const EDITABLE_TEMPLATE_NAMES = Object.keys(EDITABLE_TEMPLATES) as TemplateName[]
