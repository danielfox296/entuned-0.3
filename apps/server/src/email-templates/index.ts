// Template registry — used by /admin/email/preview to render any template by name.
//
// Add new templates here. Keep the union narrow so callers get a clean autocomplete.

import * as magicLink from './magicLink.js'
import * as welcome from './welcome.js'
import * as indemnificationCert from './indemnificationCert.js'
import * as catalogueReady from './catalogueReady.js'
import * as dunning from './dunning.js'
import * as pauseEnding from './pauseEnding.js'

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
} satisfies Record<string, TemplateModule>

export type TemplateName = keyof typeof TEMPLATES
