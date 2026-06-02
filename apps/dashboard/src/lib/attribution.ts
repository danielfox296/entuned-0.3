// First-touch signup attribution (client side).
//
// On the visitor's FIRST page view anywhere on *.entuned.co, we stamp a
// `.entuned.co` cookie (`entuned_attr`) recording the external referrer, the
// landing path, and any UTM tags. Because the cookie is scoped to the parent
// domain, it survives the entuned.co → app.entuned.co/start hop, so the TRUE
// upstream source (Google/Reddit/etc.) isn't masked by the internal referrer.
//
// The marketing site (entuned.co) sets the same cookie via an inline script in
// its base layout — SAME name + SAME shape. Whichever surface the visitor hits
// first wins (we never overwrite an existing cookie). /start reads it at signup
// and forwards it to the server, which persists it on the new Client.
//
// Cookie value = URI-encoded JSON with short keys to stay small:
//   r  = referrer, lp = landing path+query, t = ISO first-touch timestamp,
//   us/um/uc/ut/un = utm_source/medium/campaign/term/content

const COOKIE_NAME = 'entuned_attr'
const MAX_AGE_DAYS = 30

// Matches the server's Attribution shape (lib/attribution.ts) and the
// magic-link request body.
export interface Attribution {
  referrer?: string
  landingPath?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
}

interface CookiePayload {
  r?: string
  lp?: string
  us?: string
  um?: string
  uc?: string
  ut?: string
  un?: string
  t?: string
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return part.slice(prefix.length)
  }
  return null
}

// `.entuned.co` in prod (shared across the apex + every subdomain), host-only
// on localhost / preview where that domain doesn't apply.
function cookieDomainAttr(): string {
  const host = window.location.hostname
  return host === 'entuned.co' || host.endsWith('.entuned.co') ? '; domain=.entuned.co' : ''
}

// Snapshot the current page into a cookie payload (short keys).
function currentPagePayload(): CookiePayload {
  const params = new URLSearchParams(window.location.search)
  const get = (k: string) => params.get(k) || undefined
  return {
    r: document.referrer || undefined,
    lp: window.location.pathname + window.location.search || undefined,
    us: get('utm_source'),
    um: get('utm_medium'),
    uc: get('utm_campaign'),
    ut: get('utm_term'),
    un: get('utm_content'),
  }
}

/**
 * If no first-touch cookie exists yet, stamp one from the current page. Idempotent
 * and side-effect-safe — never throws (cookie writes can fail in sandboxed
 * iframes / privacy modes; attribution is best-effort and must not break signup).
 * Call once on /start mount.
 */
export function captureFirstTouch(): void {
  try {
    if (readCookie(COOKIE_NAME)) return
    const payload = currentPagePayload()
    const value = encodeURIComponent(JSON.stringify({ ...payload, t: new Date().toISOString() }))
    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60
    document.cookie = `${COOKIE_NAME}=${value}; path=/${cookieDomainAttr()}; max-age=${maxAge}; SameSite=Lax`
  } catch {
    /* best-effort */
  }
}

function payloadToAttribution(p: CookiePayload): Attribution {
  return {
    referrer: p.r,
    landingPath: p.lp,
    utmSource: p.us,
    utmMedium: p.um,
    utmCampaign: p.uc,
    utmTerm: p.ut,
    utmContent: p.un,
  }
}

/**
 * Read first-touch attribution for the signup request. Prefers the cookie
 * (true first-touch, possibly set on the marketing site); falls back to the
 * current page if the cookie is missing/unparseable (e.g. cookies blocked).
 * Returns undefined if there's nothing worth sending.
 */
export function readAttribution(): Attribution | undefined {
  let payload: CookiePayload | null = null
  const raw = readCookie(COOKIE_NAME)
  if (raw) {
    try {
      payload = JSON.parse(decodeURIComponent(raw)) as CookiePayload
    } catch {
      payload = null
    }
  }
  if (!payload) payload = currentPagePayload()
  const attr = payloadToAttribution(payload)
  // Drop empty/whitespace fields; return undefined if nothing survives.
  const cleaned: Attribution = {}
  for (const [k, v] of Object.entries(attr)) {
    if (typeof v === 'string' && v.trim()) cleaned[k as keyof Attribution] = v.trim()
  }
  return Object.keys(cleaned).length ? cleaned : undefined
}
