// HTTP client primitives for entuned frontends.
//
// Extracted from drifted req<T> / upload<T> helpers in apps/admin/src/api.ts,
// apps/dashboard/src/api.ts, and apps/player/src/api.ts. Each app keeps its
// own typed `api` surface; this package just supplies the wire-level fetch
// wrapper, error parser, and JSON guard.
//
// Two auth modes are supported by config:
//   - Bearer token (admin, player) — passed per-call as the optional `token` arg.
//   - Cookies (dashboard) — opt in with `credentials: 'include'`.

export type ApiError = Error & { status: number; code?: string }

/**
 * Parse a non-OK Response into an Error. If the server sent a structured
 * `{error, message}` JSON payload, surface `message` as the Error message and
 * attach `status` + `code`. Otherwise fall back to the raw
 * `${status} ${statusText}: ${body}` shape so callers still see something.
 */
export async function buildError(res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => '')
  let parsed: { error?: string; message?: string } | null = null
  try { parsed = JSON.parse(body) } catch { /* not json */ }
  if (parsed?.message) {
    const e = new Error(parsed.message) as ApiError
    e.status = res.status
    e.code = parsed.error
    return e
  }
  const e = new Error(`${res.status} ${res.statusText}: ${body}`) as ApiError
  e.status = res.status
  return e
}

export interface RequestClientOptions {
  /** Absolute base URL prepended to every path. */
  baseUrl: string
  /** Set to `'include'` for cookie auth (dashboard). Omit for Bearer-only apps. */
  credentials?: RequestCredentials
}

export interface RequestClient {
  /**
   * JSON request. Pass `token` to add `Authorization: Bearer ${token}`.
   * Returns parsed JSON, or undefined if the response has no JSON body
   * (e.g. 204 No Content).
   */
  req: <T>(path: string, init?: RequestInit, token?: string) => Promise<T>
  /**
   * Multipart upload. Content-Type is left to the browser so the multipart
   * boundary is set correctly. Pass `token` for Bearer auth.
   */
  upload: <T>(path: string, formData: FormData, token?: string) => Promise<T>
}

export function createRequestClient(opts: RequestClientOptions): RequestClient {
  async function req<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    }
    // Only set Content-Type when there's actually a body — Fastify rejects
    // empty JSON bodies when the header is present.
    if (init.body != null) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${opts.baseUrl}${path}`, {
      ...init,
      headers,
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    })
    if (!res.ok) throw await buildError(res)
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return undefined as unknown as T
    return res.json() as Promise<T>
  }

  async function upload<T>(path: string, formData: FormData, token?: string): Promise<T> {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${opts.baseUrl}${path}`, {
      method: 'POST',
      body: formData,
      headers,
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    })
    if (!res.ok) throw await buildError(res)
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return undefined as unknown as T
    return res.json() as Promise<T>
  }

  return { req, upload }
}
