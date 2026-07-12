// SSRF guard for server-side fetches of operator-supplied URLs. SEC-5 (2026-07-11 audit).
//
// The Operator Seeding accept flow (routes/admin.ts → lib/r2.ts) fetches a URL
// an operator pasted (a Suno share/CDN link, a Flow GCS URL, or any direct
// link) and re-hosts the body on R2. Without validation an operator could point
// it at internal infrastructure — the cloud metadata endpoint
// (169.254.169.254), localhost, or private ranges. Admin-gated, so severity is
// bounded, but we harden it.
//
// A strict host allowlist would be tightest, but the set of legitimate hosts is
// NOT stable (arbitrary Suno CDN hosts, Flow's public GCS URLs, direct links),
// so we guard on scheme + resolved IP instead: https only, and reject any host
// that resolves to a loopback / private / link-local / reserved address.
// Redirects are pinned — each hop is re-validated before it's followed — to
// close the "public URL 302s to 169.254.169.254" bypass.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const octet = Number(p)
    if (octet > 255) return null
    n = (n << 8) | octet
  }
  return n >>> 0
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)
  if (baseInt === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

// IPv4 ranges that must never be reached server-side (RFC 1918 private, loopback,
// link-local incl. cloud metadata, CGNAT, benchmarking, documentation, multicast,
// reserved, "this host", broadcast).
const V4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
]

/**
 * True if `ip` (an IP literal — IPv4 or IPv6) is in a range we must never fetch
 * from. Unparseable input is treated as blocked (fail closed). IPv4-mapped /
 * -embedded IPv6 forms (`::ffff:169.254.169.254`, `::127.0.0.1`) are unwrapped
 * and checked as IPv4.
 */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const n = ipv4ToInt(ip)
    if (n === null) return true
    return V4_BLOCKS.some(([base, bits]) => inCidr(n, base, bits))
  }
  if (kind === 6) {
    const lower = ip.toLowerCase()
    // IPv4-mapped / -embedded: trailing dotted-quad (e.g. ::ffff:169.254.169.254).
    const embedded = lower.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/)
    if (embedded) return isBlockedIp(embedded[1])
    if (lower === '::1' || lower === '::') return true // loopback / unspecified
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true // fc00::/7 unique local
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true // fe80::/10 link-local
    return false
  }
  // Not a valid IP literal — assertPublicUrl only passes real IPs here.
  return true
}

/**
 * Validate that `rawUrl` is safe to fetch server-side: https scheme, and every
 * address the host resolves to is publicly routable. Throws on any violation.
 * Returns the parsed URL on success.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error(`blocked URL (unparseable): ${rawUrl}`)
  }
  if (u.protocol !== 'https:') {
    throw new Error(`blocked URL scheme ${u.protocol} — only https is allowed`)
  }
  const host = u.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets

  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`blocked internal IP address: ${host}`)
    return u
  }

  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host, { all: true })
  } catch (e: any) {
    throw new Error(`blocked URL — DNS resolution failed for ${host}: ${e?.message ?? e}`)
  }
  if (addrs.length === 0) throw new Error(`blocked URL — no addresses resolved for ${host}`)
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      throw new Error(`blocked URL — host ${host} resolves to internal IP ${address}`)
    }
  }
  return u
}

const MAX_REDIRECTS = 5

/**
 * `fetch()` that validates the target against `assertPublicUrl` and pins
 * redirects: each 3xx `Location` is resolved and re-validated before it's
 * followed, so a public URL cannot bounce the request onto an internal address.
 * Non-redirect responses are returned as-is (caller inspects status/body).
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let current = rawUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current)
    const res = await fetch(current, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      current = new URL(location, current).toString()
      continue
    }
    return res
  }
  throw new Error(`blocked URL — too many redirects (>${MAX_REDIRECTS}) from ${rawUrl}`)
}
