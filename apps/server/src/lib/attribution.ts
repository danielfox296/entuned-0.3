// First-touch signup attribution — shared shape + helpers.
//
// Data path: a `.entuned.co` `entuned_attr` cookie is written client-side on the
// visitor's first page view (marketing site or /start). /start reads it and
// sends it in the magic-link request body; the server parks it on the
// MagicLinkToken, then copies it onto the new Client at /verify. See
// schema SSOT 03-duke.md (Client) and dashboard-auth.md (MagicLinkToken).
//
// All fields are nullable: null everywhere = direct / no attribution captured.

export interface Attribution {
  referrer: string | null
  landingPath: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
}

export const EMPTY_ATTRIBUTION: Attribution = {
  referrer: null,
  landingPath: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
}

// Field length caps. Referrer/landing URLs can be long (nested query strings);
// UTM tags are short labels. Anything past the cap is truncated, not rejected —
// we never want attribution capture to fail a signup.
const MAX_URL_LEN = 1024
const MAX_UTM_LEN = 256

function clamp(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * Coerce an untrusted `attribution` object (from the magic-link request body)
 * into a clean Attribution. Unknown/extra keys are ignored; every field is
 * trimmed, length-clamped, and empty-coerced to null. Total-garbage input
 * (undefined, null, a string, an array) yields EMPTY_ATTRIBUTION.
 */
export function sanitizeAttribution(input: unknown): Attribution {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...EMPTY_ATTRIBUTION }
  }
  const o = input as Record<string, unknown>
  return {
    referrer: clamp(o.referrer, MAX_URL_LEN),
    landingPath: clamp(o.landingPath, MAX_URL_LEN),
    utmSource: clamp(o.utmSource, MAX_UTM_LEN),
    utmMedium: clamp(o.utmMedium, MAX_UTM_LEN),
    utmCampaign: clamp(o.utmCampaign, MAX_UTM_LEN),
    utmTerm: clamp(o.utmTerm, MAX_UTM_LEN),
    utmContent: clamp(o.utmContent, MAX_UTM_LEN),
  }
}

export function attributionIsEmpty(attr: Attribution): boolean {
  return (
    !attr.referrer &&
    !attr.landingPath &&
    !attr.utmSource &&
    !attr.utmMedium &&
    !attr.utmCampaign &&
    !attr.utmTerm &&
    !attr.utmContent
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * One-line, operator-readable summary for the admin signup email. Examples:
 *   "utm: reddit / social / spring-launch · via reddit.com · landed /for-apparel"
 *   "via google.com · landed /pricing"
 *   "Direct / unknown"
 */
export function formatAttributionSummary(attr: Attribution): string {
  const parts: string[] = []
  if (attr.utmSource || attr.utmMedium || attr.utmCampaign) {
    const utm = [attr.utmSource, attr.utmMedium, attr.utmCampaign]
      .filter(Boolean)
      .join(' / ')
    parts.push(`utm: ${utm}`)
  }
  if (attr.referrer) parts.push(`via ${hostOf(attr.referrer)}`)
  if (attr.landingPath) parts.push(`landed ${attr.landingPath}`)
  return parts.length ? parts.join(' · ') : 'Direct / unknown'
}
