// Template registry — used by lib/email.ts (TS fallback rendering) and the
// admin preview/editor surface.
//
// Add new templates here. Keep the union narrow so callers get a clean autocomplete.

import * as magicLink from './magicLink.js'
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

export interface TemplateModule<P = any> {
  subject: (props: P) => string
  html: (props: P) => string
}

export const TEMPLATES = {
  magicLink,
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
])

// Sample props the admin "preview" pane uses when the operator hasn't supplied
// a custom payload. Shape matches each template's Props interface.
export const TEMPLATE_PROPS_EXAMPLES: Record<TemplateName, Record<string, unknown>> = {
  magicLink: { link: 'https://api.entuned.co/login/verify?token=sample' },
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
}
