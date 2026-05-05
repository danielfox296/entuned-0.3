// Resend email wrapper.
//
// Send-time renderer. For each template name we check the DB first
// (operator-edited copy), then fall back to the TS template module. Body and
// subject support Mustache-style `{{var}}` interpolation against props.
// Lifecycle templates (icpUnfilled, freeToCoreNudge) are gated on the
// recipient's User.lifecycleEmailsOptOut and rendered with an unsubscribe
// footer linking to a signed-token endpoint.
//
// In dev (no RESEND_API_KEY), payloads are logged to stdout instead of being
// sent — so the server runs cleanly with no outbound creds.
//
// Required env in production: RESEND_API_KEY, JWT_SECRET (already required for
// session cookies — reused for unsub tokens).
// Optional env: EMAIL_FROM (default `Entuned <hello@entuned.co>`),
// EMAIL_REPLY_TO (default `hello@entuned.co`), API_URL (used to build unsub URL).

import jwt from 'jsonwebtoken'
import { Resend } from 'resend'
import { prisma } from '../db.js'
import { layout } from '../email-templates/_layout.js'
import { LIFECYCLE_TEMPLATES, TEMPLATES, TEMPLATE_PROPS_EXAMPLES, type TemplateName } from '../email-templates/index.js'
import { EDITABLE_TEMPLATES } from '../email-templates/seeds.js'

// Tier label for the welcome variant router. Free + essentials collapse onto
// the same template since they're the same tier (essentials is the public
// label, free is the legacy DB value).
export type Tier = 'free' | 'essentials' | 'core' | 'pro'

// Dunning escalation level (1 = heads-up, 2 = direct, 3 = final).
export type DunningAttempt = 1 | 2 | 3

const FROM = process.env.EMAIL_FROM ?? 'Entuned <hello@entuned.co>'
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'hello@entuned.co'
const API_URL = process.env.API_URL ?? 'https://api.entuned.co'

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
  /** True when the recipient is opted out of lifecycle mail and was skipped. */
  skipped?: boolean
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

// ── Mustache-style {{var}} interpolation ─────────────────────────────────

function interpolate(tpl: string, props: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key) => {
    const v = props[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

// ── Unsubscribe (lifecycle / behavioral mail only) ───────────────────────

interface UnsubPayload { sub: string; act: 'unsub' }

/** Mint a stateless unsubscribe token. JWT signed with JWT_SECRET. */
export function mintUnsubToken(userId: string): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET unset; cannot mint unsub token')
  const payload: UnsubPayload = { sub: userId, act: 'unsub' }
  // No expiry — opt-out links should keep working even on old emails.
  return jwt.sign(payload, secret, { algorithm: 'HS256' })
}

export function verifyUnsubToken(token: string): string | null {
  const secret = process.env.JWT_SECRET
  if (!secret) return null
  try {
    const decoded = jwt.verify(token, secret) as UnsubPayload
    if (decoded.act !== 'unsub' || !decoded.sub) return null
    return decoded.sub
  } catch {
    return null
  }
}

function lifecycleFooter(userId: string | undefined): string {
  if (!userId) return ''
  const url = `${API_URL}/email/unsubscribe?token=${encodeURIComponent(mintUnsubToken(userId))}`
  return `<p style="margin:18px 0 0 0;font-size:11px;color:#6b6760;line-height:1.5;">You receive this kind of email because you have an Entuned account. <a href="${url}" style="color:#9a958c;text-decoration:underline;">Unsubscribe from product nudges</a> — transactional mail (sign-in, billing, account) keeps coming.</p>`
}

// ── Render a template by name ────────────────────────────────────────────

export interface RenderArgs {
  /** Recipient userId. Required when template is lifecycle-class so the unsub
   *  footer can link the right user; optional otherwise. */
  recipientUserId?: string
}

/**
 * Render a template against props. DB-first: if a row exists in
 * `email_templates` for this name we render it (interpolate + wrap). Otherwise
 * fall back to the TS template's full-HTML output. Used by both the send path
 * and the admin preview endpoint.
 */
export async function renderTemplate(
  name: TemplateName,
  props: Record<string, unknown>,
  args: RenderArgs = {},
): Promise<{ subject: string; html: string }> {
  // 1) DB row?
  const row = await prisma.emailTemplate.findUnique({ where: { name } })
  if (row) {
    const subject = interpolate(row.subject, props)
    const bodyInterpolated = interpolate(row.body, props)
    const isLifecycle = LIFECYCLE_TEMPLATES.has(name)
    const footer = isLifecycle ? lifecycleFooter(args.recipientUserId) : ''
    const html = layout({
      preheader: typeof props._preheader === 'string' ? props._preheader : undefined,
      body: bodyInterpolated + footer,
    })
    return { subject, html }
  }
  // 2) TS fallback. Variant-heavy templates (welcome, dunning) live here in v1.
  // Cast props: the TEMPLATES record's intersection-typed Props are
  // statically incompatible across templates; routing-by-name is correct at
  // runtime because each module's own subject/html is internally consistent.
  const tpl = TEMPLATES[name] as { subject: (p: any) => string; html: (p: any) => string }
  return { subject: tpl.subject(props), html: tpl.html(props) }
}

/** Send a rendered template by name. Used by the preview endpoint and ad-hoc admin sends. */
export async function sendTemplate(
  name: TemplateName,
  to: string,
  props: Record<string, unknown>,
  args: RenderArgs = {},
): Promise<SendResult> {
  const { subject, html } = await renderTemplate(name, props, args)
  return dispatch({ to, subject, html })
}

/**
 * Send a lifecycle-class template. Skips the send if the recipient is
 * opted out. Returns { ok: true, skipped: true } in that case so callers
 * (e.g. the cron) can record the attempt without flagging an error.
 */
export async function sendLifecycle(
  name: TemplateName,
  recipient: { userId: string; email: string },
  props: Record<string, unknown>,
): Promise<SendResult> {
  if (!LIFECYCLE_TEMPLATES.has(name)) {
    return { ok: false, error: `${name} is not a lifecycle template` }
  }
  const user = await prisma.user.findUnique({
    where: { id: recipient.userId },
    select: { lifecycleEmailsOptOut: true },
  })
  if (!user || user.lifecycleEmailsOptOut) {
    return { ok: true, skipped: true }
  }
  return sendTemplate(name, recipient.email, props, { recipientUserId: recipient.userId })
}

// ── One function per template (typed props) ──────────────────────────────

export async function sendMagicLink(to: string, link: string): Promise<SendResult> {
  return sendTemplate('magicLink', to, { link })
}

export async function sendWelcome(
  to: string,
  tier: Tier,
  playerUrl: string,
  dashboardUrl: string,
): Promise<SendResult> {
  const name: TemplateName =
    tier === 'pro' ? 'welcomePro'
    : tier === 'core' ? 'welcomeCore'
    : 'welcomeFree'
  return sendTemplate(name, to, { playerUrl, dashboardUrl })
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
  const name: TemplateName =
    attempt === 3 ? 'dunning3'
    : attempt === 2 ? 'dunning2'
    : 'dunning1'
  return sendTemplate(name, to, { billingPortalUrl })
}

export async function sendPauseEnding(
  to: string,
  daysRemaining: number,
  dashboardUrl: string,
): Promise<SendResult> {
  return sendTemplate('pauseEnding', to, { daysRemaining, dashboardUrl })
}

// ── Boot-time seeder ─────────────────────────────────────────────────────

/**
 * Idempotent: insert any missing DB-editable template rows from the TS seed
 * file. Never overwrites existing rows — operator edits are sacrosanct. Runs
 * on server boot from src/index.ts.
 */
export async function seedEmailTemplates(): Promise<{ created: string[] }> {
  const created: string[] = []
  for (const [name, seed] of Object.entries(EDITABLE_TEMPLATES)) {
    if (!seed) continue
    const existing = await prisma.emailTemplate.findUnique({ where: { name } })
    if (existing) continue
    await prisma.emailTemplate.create({
      data: {
        name,
        subject: seed.subject,
        body: seed.body,
        propsExample: seed.propsExample as any,
      },
    })
    created.push(name)
  }
  return { created }
}

// Re-export for the admin endpoint's preview pane.
export { TEMPLATE_PROPS_EXAMPLES }
