// Signup insight helpers — turn the write-once `Client.attr_*` attribution
// columns into "what material is converting" and "which of these is junk".
//
// The attribution fields have been captured since the /start → MagicLinkToken
// → Client pipeline landed (see lib/attribution.ts), but nothing reads them
// back. Everything here is pure: the Prisma reads and the printing live in
// scripts/analyze-signups.ts, so the scoring and rollup logic is unit-testable
// without a DB.
//
// Two axes, deliberately kept apart:
//   • identity   — does this signup look like a real person? (email shape,
//                  disposable domains, alias collisions, same-domain bursts)
//   • engagement — did they do anything after signing up?
// A dead lead is not the same thing as a bot, and conflating them buries real
// prospects in the spam bucket. `spamVerdict()` combines the two only at the
// end, and only ever escalates on identity evidence.

import type { Attribution } from './attribution.js'

// ── Cohort shape ─────────────────────────────────────────────────────────

/** One PLG signup: a Client with an owner Account, flattened for analysis. */
export interface SignupRecord {
  clientId: string
  companyName: string
  /** Owner Account email. Null only if the membership row lost its Account. */
  email: string | null
  /** Client.createdAt — the moment the magic link was consumed. */
  signedUpAt: Date
  lastLoginAt: Date | null
  /** Client.industry — null means /onboard was never completed. */
  industry: string | null
  attribution: Attribution
  /** ICPs with source='onboarding' — audiences the customer built themselves. */
  ownIcpCount: number
  playbackCount: number
  firstPlaybackAt: Date | null
  /** Any Store on a paid tier or carrying a live Stripe subscription. */
  paid: boolean
}

// ── Funnel ───────────────────────────────────────────────────────────────

export type FunnelStage = 'signed_up' | 'onboarded' | 'audience_built' | 'activated' | 'paid'

/** Ordered weakest → strongest. Index doubles as the stage's rank. */
export const FUNNEL_STAGES: readonly FunnelStage[] = [
  'signed_up',
  'onboarded',
  'audience_built',
  'activated',
  'paid',
] as const

/**
 * The furthest stage this signup reached. Monotonic by construction: a paid
 * customer counts as having reached every earlier stage in the rollups, even
 * if (say) they never filled in `industry`, so channel conversion rates can
 * never read as non-monotonic.
 */
export function furthestStage(r: SignupRecord): FunnelStage {
  if (r.paid) return 'paid'
  if (r.playbackCount > 0) return 'activated'
  if (r.ownIcpCount > 0) return 'audience_built'
  if (r.industry) return 'onboarded'
  return 'signed_up'
}

export function stageRank(stage: FunnelStage): number {
  return FUNNEL_STAGES.indexOf(stage)
}

export function reachedStage(r: SignupRecord, stage: FunnelStage): boolean {
  return stageRank(furthestStage(r)) >= stageRank(stage)
}

// ── Grouping keys ────────────────────────────────────────────────────────

export const DIRECT_CHANNEL = 'direct / unknown'
export const UNKNOWN_MATERIAL = '(no landing path captured)'

function hostOf(url: string): string {
  try {
    const h = new URL(url).host
    return h ? h.replace(/^www\./, '') : url
  } catch {
    return url
  }
}

/**
 * Coarse acquisition channel. UTM tags win over the referrer header because
 * they're the thing we actually control; a referral code beats a bare
 * referrer for the same reason.
 */
export function channelOf(attr: Attribution): string {
  if (attr.utmSource) {
    const parts = [attr.utmSource, attr.utmMedium ?? '(no medium)']
    if (attr.utmCampaign) parts.push(attr.utmCampaign)
    return parts.join(' / ')
  }
  if (attr.referralCode) return `referral / ${attr.referralCode}`
  if (attr.referrer) return hostOf(attr.referrer)
  return DIRECT_CHANNEL
}

/**
 * The page they landed on — the closest thing we store to "which material did
 * this". Query strings are dropped so /for-apparel?x=1 and /for-apparel group.
 */
export function materialOf(attr: Attribution): string {
  if (!attr.landingPath) return UNKNOWN_MATERIAL
  const path = attr.landingPath.split(/[?#]/)[0] || attr.landingPath
  // Trailing slash is noise; keep a bare "/" as-is.
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * The specific creative, when tagged. utm_content is the per-asset slot
 * (ad variant, post, email link); utm_term is the keyword slot.
 */
export function creativeOf(attr: Attribution): string | null {
  const parts = [attr.utmCampaign, attr.utmContent, attr.utmTerm].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// ── Email shape ──────────────────────────────────────────────────────────

/**
 * Consumer mailbox providers. Not a quality signal on their own — most small
 * retailers sign up with a personal address — but they mean "same domain" is
 * meaningless for burst detection and alias collapsing.
 */
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'rocketmail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com',
  'outlook.co.uk', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'mail.com', 'yandex.com', 'zoho.com', 'hey.com', 'fastmail.com',
  'hushmail.com', 'comcast.net', 'verizon.net', 'sbcglobal.net', 'att.net',
  'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net', 'optonline.net',
])

/**
 * Known throwaway-inbox providers. Matched on the exact domain or any
 * subdomain of it — several of these hand out `*.mailinator.com` addresses.
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'mailinator.net', 'guerrillamail.com', 'guerrillamail.net',
  'sharklasers.com', 'grr.la', 'spam4.me', '10minutemail.com',
  '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'tempr.email',
  'tmpmail.org', 'throwawaymail.com', 'trashmail.com', 'trashmail.de',
  'yopmail.com', 'yopmail.fr', 'getnada.com', 'nada.email', 'dispostable.com',
  'maildrop.cc', 'mailnesia.com', 'fakeinbox.com', 'spamgourmet.com',
  'mintemail.com', 'moakt.com', 'emailondeck.com', 'discard.email',
  'inboxkitten.com', 'mohmal.com', 'luxusmail.org', 'mail7.io',
  'byom.de', 'einrot.com', 'harakirimail.com', 'anonbox.net',
  'burnermail.io', 'mailcatch.com', 'tempinbox.com', 'notsharingmy.info',
])

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

export function localPartOf(email: string): string {
  const at = email.lastIndexOf('@')
  return (at === -1 ? email : email.slice(0, at)).trim().toLowerCase()
}

export function isFreemail(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain)
}

export function isDisposableDomain(domain: string): boolean {
  if (!domain) return false
  if (DISPOSABLE_DOMAINS.has(domain)) return true
  for (const d of DISPOSABLE_DOMAINS) {
    if (domain.endsWith(`.${d}`)) return true
  }
  return false
}

/**
 * Collapse the aliases a single mailbox can present. Gmail ignores dots and
 * everything after a `+`; most other providers honour dots but still strip the
 * `+tag`. Two records sharing a canonical address are the same inbox.
 */
export function canonicalEmail(email: string): string {
  const domain = domainOf(email)
  let local = localPartOf(email)
  const plus = local.indexOf('+')
  if (plus !== -1) local = local.slice(0, plus)
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '')
    return `${local}@gmail.com`
  }
  return `${local}@${domain}`
}

function longestConsonantRun(letters: string): number {
  let best = 0
  let run = 0
  for (const ch of letters) {
    if ('aeiouy'.includes(ch)) {
      run = 0
    } else {
      run += 1
      if (run > best) best = run
    }
  }
  return best
}

/**
 * Heuristic "does this local part look keyboard-mashed or generated".
 * Deliberately conservative — a false positive here puts a real prospect in
 * the suspect bucket, which is worse than missing a bot.
 */
export function looksMachineGenerated(local: string): boolean {
  const lower = local.toLowerCase()

  // firstname.lastname / first_last is the most common real-person shape.
  const tokens = lower.split(/[._-]+/).filter(Boolean)
  if (tokens.length >= 2 && tokens.every((t) => /^[a-z]+$/.test(t) && /[aeiouy]/.test(t))) {
    return false
  }

  const cleaned = lower.replace(/[^a-z0-9]/g, '')
  if (cleaned.length < 8) return false

  const letters = cleaned.replace(/[^a-z]/g, '')
  const digits = cleaned.replace(/\D/g, '')

  // Six consonants in a row basically doesn't happen in a name or a word.
  if (longestConsonantRun(letters) >= 6) return true

  // Low vowel density, but only once the string is long enough that the
  // initial-plus-surname shape ("jsmith84", "mjones") can't trip it.
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length
  if (letters.length >= 10 && vowels / letters.length < 0.2) return true

  // Long letter stem plus a long digit tail — the classic generated handle.
  if (digits.length >= 6 && letters.length >= 4) return true

  return false
}

// ── Spam / quality scoring ───────────────────────────────────────────────

export type SpamLevel = 'clean' | 'suspect' | 'likely_spam'
export type Engagement = 'engaged' | 'dormant' | 'too_early'

export interface SpamVerdict {
  /** Identity-evidence score only. Behaviour never contributes to it. */
  score: number
  level: SpamLevel
  /** Human-readable identity signals, strongest first. */
  reasons: string[]
  engagement: Engagement
  /** Why the engagement bucket came out the way it did. */
  engagementNote: string
}

/**
 * How long a brand-new signup gets before silence counts against it. Below
 * this age a quiet account is `too_early`, never `dormant`.
 */
export const ENGAGEMENT_GRACE_DAYS = 3

/** Same-domain signups inside this window, at this count, read as a burst. */
const BURST_WINDOW_MS = 60 * 60 * 1000
const BURST_MIN_COUNT = 3

export interface SpamContext {
  now: Date
  /** canonical address → how many records in the cohort share it */
  aliasCounts: Map<string, number>
  /** non-freemail domain → signup timestamps (ms), ascending */
  domainTimestamps: Map<string, number[]>
}

export function buildSpamContext(records: SignupRecord[], now: Date): SpamContext {
  const aliasCounts = new Map<string, number>()
  const domainTimestamps = new Map<string, number[]>()

  for (const r of records) {
    if (!r.email) continue
    const canonical = canonicalEmail(r.email)
    aliasCounts.set(canonical, (aliasCounts.get(canonical) ?? 0) + 1)

    const domain = domainOf(r.email)
    // Freemail bursts are meaningless (everyone is @gmail.com) and disposable
    // domains already score on their own — don't double-count them here.
    if (!domain || isFreemail(domain) || isDisposableDomain(domain)) continue
    const list = domainTimestamps.get(domain) ?? []
    list.push(r.signedUpAt.getTime())
    domainTimestamps.set(domain, list)
  }

  for (const list of domainTimestamps.values()) list.sort((a, b) => a - b)

  return { now, aliasCounts, domainTimestamps }
}

/** Signups on `domain` within BURST_WINDOW_MS of `at`, inclusive of itself. */
function burstSize(ctx: SpamContext, domain: string, at: number): number {
  const list = ctx.domainTimestamps.get(domain)
  if (!list) return 0
  return list.filter((t) => Math.abs(t - at) <= BURST_WINDOW_MS).length
}

export function ageInDays(r: SignupRecord, now: Date): number {
  return (now.getTime() - r.signedUpAt.getTime()) / 86_400_000
}

function classifyEngagement(r: SignupRecord, now: Date): { engagement: Engagement; note: string } {
  if (r.paid) return { engagement: 'engaged', note: 'converted to paid' }
  if (r.playbackCount > 0) return { engagement: 'engaged', note: `${r.playbackCount} playback events` }
  if (r.ownIcpCount > 0) return { engagement: 'engaged', note: 'built an audience' }
  if (r.industry) return { engagement: 'engaged', note: 'completed onboarding' }

  // A returning sign-in is weak but real intent — they came back for something.
  const returned =
    r.lastLoginAt !== null && r.lastLoginAt.getTime() - r.signedUpAt.getTime() > 5 * 60 * 1000
  if (returned) return { engagement: 'engaged', note: 'signed back in later' }

  if (ageInDays(r, now) < ENGAGEMENT_GRACE_DAYS) {
    return { engagement: 'too_early', note: `signed up <${ENGAGEMENT_GRACE_DAYS}d ago` }
  }
  return { engagement: 'dormant', note: 'no onboarding, no audience, no plays, never returned' }
}

/**
 * Score one signup. Identity signals build `score`; engagement is reported
 * separately and can only escalate a level that already has identity evidence
 * behind it (score ≥ 1). A quiet-but-plausible signup stays `clean`.
 */
export function spamVerdict(r: SignupRecord, ctx: SpamContext): SpamVerdict {
  const reasons: string[] = []
  let score = 0

  if (r.email) {
    const domain = domainOf(r.email)
    const local = localPartOf(r.email)

    if (isDisposableDomain(domain)) {
      score += 4
      reasons.push(`disposable inbox provider (${domain})`)
    }

    if (looksMachineGenerated(local)) {
      score += 3
      reasons.push(`email local part looks generated ("${local}")`)
    } else if (/\d{5,}/.test(local)) {
      score += 1
      reasons.push('long digit run in the email local part')
    }

    const canonical = canonicalEmail(r.email)
    const aliasCount = ctx.aliasCounts.get(canonical) ?? 0
    if (aliasCount > 1) {
      score += 3
      reasons.push(`${aliasCount} signups resolve to the same inbox (${canonical})`)
    }

    if (domain && !isFreemail(domain) && !isDisposableDomain(domain)) {
      const burst = burstSize(ctx, domain, r.signedUpAt.getTime())
      if (burst >= BURST_MIN_COUNT) {
        score += 2
        reasons.push(`${burst} signups on ${domain} within an hour`)
      }
    }
  } else {
    score += 2
    reasons.push('no owner email on the account')
  }

  const { engagement, note } = classifyEngagement(r, ctx.now)

  let level: SpamLevel = 'clean'
  if (score >= 4 || (score >= 2 && engagement === 'dormant')) {
    level = 'likely_spam'
  } else if (score >= 2 || (score >= 1 && engagement === 'dormant')) {
    level = 'suspect'
  }

  return { score, level, reasons, engagement, engagementNote: note }
}

export interface ScoredSignup extends SignupRecord {
  stage: FunnelStage
  verdict: SpamVerdict
}

export function scoreCohort(records: SignupRecord[], now: Date): ScoredSignup[] {
  const ctx = buildSpamContext(records, now)
  return records.map((r) => ({ ...r, stage: furthestStage(r), verdict: spamVerdict(r, ctx) }))
}

// ── Rollups ──────────────────────────────────────────────────────────────

export interface RollupRow {
  key: string
  signups: number
  onboarded: number
  audienceBuilt: number
  activated: number
  paid: number
  /** suspect + likely_spam, so a channel's inflation is visible inline. */
  flagged: number
  likelySpam: number
  /** Real (non-flagged) signups — the denominator worth trusting. */
  clean: number
}

function emptyRow(key: string): RollupRow {
  return {
    key,
    signups: 0,
    onboarded: 0,
    audienceBuilt: 0,
    activated: 0,
    paid: 0,
    flagged: 0,
    likelySpam: 0,
    clean: 0,
  }
}

/**
 * Group a scored cohort by any key function and count the funnel at each
 * stage. Rows come back busiest-first, ties broken alphabetically so output
 * is stable across runs.
 */
export function rollup(records: ScoredSignup[], keyFn: (r: ScoredSignup) => string): RollupRow[] {
  const rows = new Map<string, RollupRow>()

  for (const r of records) {
    const key = keyFn(r)
    const row = rows.get(key) ?? emptyRow(key)
    row.signups += 1
    if (reachedStage(r, 'onboarded')) row.onboarded += 1
    if (reachedStage(r, 'audience_built')) row.audienceBuilt += 1
    if (reachedStage(r, 'activated')) row.activated += 1
    if (reachedStage(r, 'paid')) row.paid += 1
    if (r.verdict.level === 'likely_spam') row.likelySpam += 1
    if (r.verdict.level !== 'clean') row.flagged += 1
    else row.clean += 1
    rows.set(key, row)
  }

  return [...rows.values()].sort((a, b) => b.signups - a.signups || a.key.localeCompare(b.key))
}

/** Whole-cohort funnel counts, same shape as a rollup row. */
export function funnelTotals(records: ScoredSignup[]): RollupRow {
  return rollup(records, () => 'all')[0] ?? emptyRow('all')
}

export function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}

/**
 * Share of the cohort that arrived with no attribution at all. High here means
 * the channel rollups are guesswork, not that everyone came direct — worth
 * printing above the tables so nobody over-reads them.
 */
export function attributionCoverage(records: SignupRecord[]): {
  total: number
  withAny: number
  withUtm: number
  withLandingPath: number
} {
  let withAny = 0
  let withUtm = 0
  let withLandingPath = 0
  for (const r of records) {
    const a = r.attribution
    if (a.utmSource || a.utmMedium || a.utmCampaign || a.utmTerm || a.utmContent) withUtm += 1
    if (a.landingPath) withLandingPath += 1
    if (
      a.referrer ||
      a.landingPath ||
      a.utmSource ||
      a.utmMedium ||
      a.utmCampaign ||
      a.utmTerm ||
      a.utmContent ||
      a.referralCode
    ) {
      withAny += 1
    }
  }
  return { total: records.length, withAny, withUtm, withLandingPath }
}
