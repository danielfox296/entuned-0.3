// Resend email wrapper.
//
// Typed thin layer over the Resend Node SDK. One exported function per
// transactional template. In dev (no RESEND_API_KEY), payloads are logged
// to stdout instead of being sent — so the server runs cleanly with no
// outbound creds.
//
// Required env in production: RESEND_API_KEY.
// Optional env: EMAIL_FROM (default `Entuned <hello@entuned.co>`),
// EMAIL_REPLY_TO (default `hello@entuned.co`).

import { Resend } from 'resend'
import { TEMPLATES, type TemplateName } from '../email-templates/index.js'
import type { Tier } from '../email-templates/welcome.js'
import type { DunningAttempt } from '../email-templates/dunning.js'

const FROM = process.env.EMAIL_FROM ?? 'Entuned <hello@entuned.co>'
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'hello@entuned.co'

let client: Resend | null = null
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!client) client = new Resend(key)
  return client
}

export interface SendResult {
  ok: boolean
  id?: string
  /** True when no RESEND_API_KEY is set and the payload was logged instead. */
  dryRun?: boolean
  error?: string
}

interface SendArgs {
  to: string
  subject: string
  html: string
}

/** Internal — actually dispatch (or dry-run log). */
async function dispatch(args: SendArgs): Promise<SendResult> {
  const c = getClient()
  if (!c) {
    // Dev mode: log a compact preview rather than spamming the console with full HTML.
    console.log('[email:dry-run]', JSON.stringify({
      from: FROM,
      replyTo: REPLY_TO,
      to: args.to,
      subject: args.subject,
      htmlBytes: args.html.length,
    }))
    return { ok: true, dryRun: true }
  }
  try {
    const res = await c.emails.send({
      from: FROM,
      to: args.to,
      replyTo: REPLY_TO,
      subject: args.subject,
      html: args.html,
    })
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true, id: res.data?.id }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown_error' }
  }
}

/** Render a template by name with arbitrary props. Used by the preview endpoint. */
export function renderTemplate(name: TemplateName, props: any): { subject: string; html: string } {
  const tpl = TEMPLATES[name]
  return { subject: tpl.subject(props), html: tpl.html(props) }
}

/** Send a rendered template by name. Used by the preview endpoint and ad-hoc admin sends. */
export async function sendTemplate(name: TemplateName, to: string, props: any): Promise<SendResult> {
  const { subject, html } = renderTemplate(name, props)
  return dispatch({ to, subject, html })
}

// ----- One function per template (typed props) -----

export async function sendMagicLink(to: string, link: string): Promise<SendResult> {
  return sendTemplate('magicLink', to, { link })
}

export async function sendWelcome(
  to: string,
  tier: Tier,
  playerUrl: string,
  dashboardUrl: string,
): Promise<SendResult> {
  return sendTemplate('welcome', to, { tier, playerUrl, dashboardUrl })
}

export async function sendIndemnificationCert(
  to: string,
  accountId: string,
  pdfUrl: string,
): Promise<SendResult> {
  return sendTemplate('indemnificationCert', to, { accountId, pdfUrl })
}

export async function sendCatalogueReady(to: string, dashboardUrl: string): Promise<SendResult> {
  return sendTemplate('catalogueReady', to, { dashboardUrl })
}

export async function sendDunning(
  to: string,
  attempt: DunningAttempt,
  billingPortalUrl: string,
): Promise<SendResult> {
  return sendTemplate('dunning', to, { attempt, billingPortalUrl })
}

export async function sendPauseEnding(
  to: string,
  daysRemaining: number,
  dashboardUrl: string,
): Promise<SendResult> {
  return sendTemplate('pauseEnding', to, { daysRemaining, dashboardUrl })
}
