// CORS origin allowlist. SEC-4 (2026-07-11 audit).
//
// The API previously registered `@fastify/cors` with `origin: true`, which
// reflects ANY caller's Origin back with `Access-Control-Allow-Credentials:
// true` — so any website could make credentialed cross-origin requests and
// read the responses. That defeats CORS as a defense layer. We pin an explicit
// allowlist instead.
//
// The only browser origins that call this API cross-origin are the three app
// subdomains (customer dashboard sends the session cookie; admin + player send
// a Bearer token) plus local dev servers. The brand site (entuned.co) posts its
// forms to Formspree, not here, so it needs no entry.

// Production browser origins allowed to make credentialed requests.
const PROD_ORIGINS = new Set([
  'https://app.entuned.co', // customer dashboard (cookie session)
  'https://dash.entuned.co', // operator admin ("Dash", Bearer)
  'https://music.entuned.co', // in-store player (Bearer)
])

// Local dev servers: dashboard :5173, player :5174, admin-local :5178. Any
// localhost / 127.0.0.1 port is allowed so a Vite port bump doesn't break dev.
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Decide whether a request Origin may make a credentialed cross-origin call.
 *
 * A request with no Origin header (`undefined`) is not a browser cross-origin
 * read at all — same-origin navigations, server-to-server calls (populate-songs
 * over railway ssh, curl), and the Railway healthcheck all arrive without one.
 * Those are allowed; the reflection risk only exists when an Origin is present.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true
  if (PROD_ORIGINS.has(origin)) return true
  if (LOCALHOST_RE.test(origin)) return true
  return false
}
