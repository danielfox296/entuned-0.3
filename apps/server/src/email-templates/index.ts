// Template registry — used by lib/email.ts (TS fallback rendering) and the
// admin preview/editor surface.
//
// Add new templates here. Keep the union narrow so callers get a clean autocomplete.

import * as magicLink from './magicLink.js'
import * as operatorPasswordReset from './operatorPasswordReset.js'
import * as welcomeFree from './welcomeFree.js'
import * as welcomeCore from './welcomeCore.js'
import * as welcomePro from './welcomePro.js'
import * as indemnificationCert from './indemnificationCert.js'
import * as catalogueReady from './catalogueReady.js'
import * as dunning1 from './dunning1.js'
import * as dunning2 from './dunning2.js'
import * as dunning3 from './dunning3.js'
import * as pauseEnding from './pauseEnding.js'
import * as icpUnfilled from './icpUnfilled.js'
import * as freeToCoreNudge from './freeToCoreNudge.js'
import * as engagedFreeToCore from './engagedFreeToCore.js'
import * as scalingCoreToPro from './scalingCoreToPro.js'
import * as establishedCoreToPro from './establishedCoreToPro.js'
import * as compEnding from './compEnding.js'
import * as compEnded from './compEnded.js'
import * as boostTrialStreamReady from './boostTrialStreamReady.js'
import * as boostTrialEngagement from './boostTrialEngagement.js'
import * as boostTrialEnding from './boostTrialEnding.js'
import * as boostTrialExpired from './boostTrialExpired.js'
import * as postConversionBenchmark from './postConversionBenchmark.js'
import * as free_drip_invisible_channel from './free_drip_invisible_channel.js'
import * as free_drip_proof from './free_drip_proof.js'
import * as free_drip_whats_missing from './free_drip_whats_missing.js'
import * as free_drip_case_study from './free_drip_case_study.js'
import * as free_drip_trial_offer from './free_drip_trial_offer.js'
import * as free_drip_last_nudge from './free_drip_last_nudge.js'

export interface TemplateModule<P = any> {
  subject: (props: P) => string
  html: (props: P) => string
}

export const TEMPLATES = {
  magicLink,
  operatorPasswordReset,
  welcomeFree,
  welcomeCore,
  welcomePro,
  indemnificationCert,
  catalogueReady,
  dunning1,
  dunning2,
  dunning3,
  pauseEnding,
  icpUnfilled,
  freeToCoreNudge,
  engagedFreeToCore,
  scalingCoreToPro,
  establishedCoreToPro,
  compEnding,
  compEnded,
  boostTrialStreamReady,
  boostTrialEngagement,
  boostTrialEnding,
  boostTrialExpired,
  postConversionBenchmark,
  free_drip_invisible_channel,
  free_drip_proof,
  free_drip_whats_missing,
  free_drip_case_study,
  free_drip_trial_offer,
  free_drip_last_nudge,
} satisfies Record<string, TemplateModule>

export type TemplateName = keyof typeof TEMPLATES

// Templates that count as behavioral / lifecycle mail. Subject to
// User.lifecycleEmailsOptOut and rendered with an unsubscribe footer.
// Everything else is transactional (operationally required) and ignores opt-out.
export const LIFECYCLE_TEMPLATES = new Set<TemplateName>([
  'icpUnfilled',
  'freeToCoreNudge',
  'engagedFreeToCore',
  'scalingCoreToPro',
  'establishedCoreToPro',
  'compEnding',
  'compEnded',
  'boostTrialStreamReady',
  'boostTrialEngagement',
  'boostTrialEnding',
  'boostTrialExpired',
  'postConversionBenchmark',
  'free_drip_invisible_channel',
  'free_drip_proof',
  'free_drip_whats_missing',
  'free_drip_case_study',
  'free_drip_trial_offer',
  'free_drip_last_nudge',
])

// Sample props the admin "preview" pane uses when the operator hasn't supplied
// a custom payload. Shape matches each template's Props interface.
export const TEMPLATE_PROPS_EXAMPLES: Record<TemplateName, Record<string, unknown>> = {
  magicLink: { link: 'https://api.entuned.co/login/verify?token=sample' },
  operatorPasswordReset: { link: 'https://dash.entuned.co/#reset-password?token=sample' },
  welcomeFree: {
    playerUrl: 'https://music.entuned.co/sample-store-1234',
    dashboardUrl: 'https://app.entuned.co',
  },
  welcomeCore: {
    playerUrl: 'https://music.entuned.co/sample-store-1234',
    dashboardUrl: 'https://app.entuned.co',
  },
  welcomePro: {
    playerUrl: 'https://music.entuned.co/sample-store-1234',
    dashboardUrl: 'https://app.entuned.co',
  },
  indemnificationCert: {
    accountId: '00000000-0000-0000-0000-000000000000',
    pdfUrl: 'https://app.entuned.co/cert/sample.pdf',
  },
  catalogueReady: { dashboardUrl: 'https://app.entuned.co' },
  dunning1: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  dunning2: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  dunning3: { billingPortalUrl: 'https://billing.stripe.com/sample' },
  pauseEnding: { daysRemaining: 7, dashboardUrl: 'https://app.entuned.co' },
  icpUnfilled: { intakeUrl: 'https://app.entuned.co/intake' },
  freeToCoreNudge: {
    upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
    playerUrl: 'https://music.entuned.co/sample-store-1234',
  },
  engagedFreeToCore: {
    upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
    songsPlayed: 247,
  },
  scalingCoreToPro: {
    upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=pro',
    storeCount: 3,
  },
  establishedCoreToPro: {
    upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=pro',
  },
  compEnding: {
    effectiveTier: 'pro',
    paidTier: 'core',
    daysRemaining: 7,
    endsOn: 'Aug 12, 2026',
    upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
    dashboardUrl: 'https://app.entuned.co',
  },
  compEnded: {
    formerCompTier: 'pro',
    paidTier: 'core',
    upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
    dashboardUrl: 'https://app.entuned.co',
  },
  boostTrialStreamReady: {
    playerUrl: 'https://music.entuned.co/sample-store-1234',
    dashboardUrl: 'https://app.entuned.co',
    daysRemaining: 29,
  },
  boostTrialEngagement: {
    daysRemaining: 16,
    upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
    dashboardUrl: 'https://app.entuned.co',
  },
  boostTrialEnding: {
    daysRemaining: 5,
    upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
    dashboardUrl: 'https://app.entuned.co',
  },
  boostTrialExpired: {
    upgradeUrl: 'https://api.entuned.co/billing/upgrade-from-comp?store=sample',
    dashboardUrl: 'https://app.entuned.co',
  },
  postConversionBenchmark: {
    benchmarkUrl: 'https://app.entuned.co/benchmark',
    dashboardUrl: 'https://app.entuned.co',
  },
  free_drip_invisible_channel: {
    upgradeUrl: 'https://entuned.co/pricing.html',
    playerUrl: 'https://music.entuned.co/sample-store-1234',
  },
  free_drip_proof: {
    upgradeUrl: 'https://entuned.co/pricing.html',
    playerUrl: 'https://music.entuned.co/sample-store-1234',
  },
  free_drip_whats_missing: {
    upgradeUrl: 'https://entuned.co/pricing.html',
    playerUrl: 'https://music.entuned.co/sample-store-1234',
  },
  free_drip_case_study: {
    upgradeUrl: 'https://entuned.co/pricing.html',
  },
  free_drip_trial_offer: {
    trialUrl: 'https://entuned.co/pricing.html',
  },
  free_drip_last_nudge: {
    upgradeUrl: 'https://entuned.co/pricing.html',
  },
}
