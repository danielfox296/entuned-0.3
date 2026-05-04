// API client for the customer-facing Entuned dashboard.
//
// Differs from apps/admin/src/api.ts in one important way: dashboard auth is
// session-cookie based (magic-link / Google OAuth on the server set an httpOnly
// cookie), so every request goes out with `credentials: 'include'`. The admin
// app uses a Bearer token in localStorage; we deliberately do not duplicate
// that pattern here.

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  }
  if (init.body != null) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  // Some endpoints (logout etc.) return 204 — guard json parse.
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return undefined as unknown as T
  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────

export type Role = 'owner' | 'manager' | 'staff'

export interface MeUser {
  id: string
  email: string
  displayName: string | null
}

export interface MeAccount {
  id: string
  companyName: string
  plan: string
}

export interface MeResponse {
  user: MeUser
  account: MeAccount
  role: Role
}

export interface MagicLinkResponse {
  ok: true
}

export interface CheckoutSessionResponse {
  account: MeAccount
  status: 'provisioned' | 'pending'
}

// ── API methods ───────────────────────────────────────────────────

export const api = {
  me: () => req<MeResponse>('/login/me'),

  requestMagicLink: (email: string) =>
    req<MagicLinkResponse>('/login/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // GET-redirect endpoint, but expose the URL helper here so call-sites import
  // the constant rather than hardcoding it.
  googleLoginUrl: () => `${API_URL}/login/google`,

  logout: () =>
    req<void>('/login/logout', { method: 'POST' }),

  // Confirm a Stripe Checkout session has provisioned the account, used by
  // the Welcome screen after checkout returns.
  confirmCheckoutSession: (sessionId: string) =>
    req<CheckoutSessionResponse>('/billing/checkout-session/confirm', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
}
