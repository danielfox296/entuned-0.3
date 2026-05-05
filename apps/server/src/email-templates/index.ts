// Template registry — used by lib/email.ts (TS fallback rendering) and the
// admin preview/editor surface.
//
// Add new templates here. Keep the union narrow so callers get a clean autocomplete.

import * as magicLink from './magicLink.js'
import * as welcome from './welcome.js'
import * as indemnificationCert from './indemnificationCert.js'
import * as catalogueReady from './catalogueReady.js'
import * as dunning from './dunning.js'
import * as pauseEnding from './pauseEnding.js'
import * as icpUnfilled from './icpUnfilled.js'
import * as freeToCoreNudge from './freeToCoreNudge.js'

export interface TemplateModule<P = any> {
  subject: (props: P) => string
  html: (props: P) => string
}

export const TEMPLATES = {
  magicLink,
  welcome,
  indemnificationCert,
  catalogueReady,
  dunning,
  pauseEnding,
  icpUnfilled,
  freeToCoreNudge,
} satisfies Record<string, TemplateModule>

export type TemplateName = keyof typeof TEMPLATES

// Templates that count as behavioral / lifecycle mail. Subject to
// User.lifecycleEmailsOptOut and rendered with an unsubscribe footer.
// Everything else is transactional (operationally required) and ignores opt-out.
export const LIFECYCLE_TEMPLATES = new Set<TemplateName>([
  'icpUnfilled',
  'freeToCoreNudge',
])

// Sample props the admin "preview" pane uses when the operator hasn't supplied
// a custom payload. Shape matches each template's Props interface.
export const TEMPLATE_PROPS_EXAMPLES: Record<TemplateName, Record<string, unknown>> = {
  magicLink: { link: 'https://api.entuned.co/login/verify?token=sample' },
  welcome: {
    tier: 'core',
    playerUrl: 'https://music.entuned.co/sample-store-1234',
    dashboardUrl: 'https://app.entuned.co',
  },
  indemnificationCert: {
    accountId: '00000000-0000-0000-0000-000000000000',
    pdfUrl: 'https://app.entuned.co/cert/sample.pdf',
  },
  catalogueReady: { dashboardUrl: 'https://app.entuned.co' },
  dunning: { attempt: 1, billingPortalUrl: 'https://billing.stripe.com/sample' },
  pauseEnding: { daysRemaining: 7, dashboardUrl: 'https://app.entuned.co' },
  icpUnfilled: { intakeUrl: 'https://app.entuned.co/intake' },
  freeToCoreNudge: {
    upgradeUrl: 'https://api.entuned.co/billing/checkout?tier=core',
    playerUrl: 'https://music.entuned.co/sample-store-1234',
  },
}
