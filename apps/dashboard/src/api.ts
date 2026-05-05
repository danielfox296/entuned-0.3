// API client for the customer-facing Entuned dashboard.
//
// Differs from apps/admin/src/api.ts in one important way: dashboard auth is
// session-cookie based (magic-link / Google OAuth on the server set an httpOnly
// cookie), so every request goes out with `credentials: 'include'`. The admin
// app uses a Bearer token in localStorage; we deliberately do not duplicate
// that pattern here.

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
export const PLAYER_URL = import.meta.env.VITE_PLAYER_URL ?? 'https://music.entuned.co'

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
export type Tier = 'free' | 'core' | 'pro' | 'enterprise'

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

export interface StoreSubscriptionSummary {
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export interface StoreRow {
  id: string
  name: string
  slug: string
  tier: Tier
  pausedUntil: string | null
  subscription: StoreSubscriptionSummary | null
}

export interface IcpInput {
  name: string
  ageRange?: string | null
  location?: string | null
  values?: string | null
  desires?: string | null
  unexpressedDesires?: string | null
  turnOffs?: string | null
}

export interface IcpRow extends IcpInput {
  id: string
  updatedAt: string
}

export interface MeIcpResponse {
  icp: IcpRow | null
  store: { id: string } | null
}

// ── Tier helpers ──────────────────────────────────────────────────

export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  core: 1,
  pro: 2,
  enterprise: 3,
}

export const TIER_LABEL: Record<Tier, string> = {
  free: 'Essentials',
  core: 'Core',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export const TIER_PRICE: Record<Tier, string> = {
  free: 'Free',
  core: '$99 / location / month',
  pro: '$399 / location / month',
  enterprise: 'Custom',
}

/** Highest-rank tier across a Client's stores. Returns 'free' for empty input. */
export function highestTier(stores: StoreRow[]): Tier {
  if (stores.length === 0) return 'free'
  return stores.reduce<Tier>((best, s) => (TIER_RANK[s.tier] > TIER_RANK[best] ? s.tier : best), 'free')
}

/** Headline store for surfaces that show a single store (e.g. Home). Picks
 * the highest-tier store so a paid customer sees the store they're paying
 * for, not the leftover free store from before they upgraded. */
export function primaryStore(stores: StoreRow[]): StoreRow | null {
  if (stores.length === 0) return null
  return stores.reduce((best, s) => (TIER_RANK[s.tier] > TIER_RANK[best.tier] ? s : best), stores[0])
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

  // ── /me/* (customer-facing, scoped to the authed Client) ──
  meStores: () => req<{ stores: StoreRow[] }>('/me/stores'),
  meIcp: () => req<MeIcpResponse>('/me/icp'),
  saveMeIcp: (input: IcpInput) =>
    req<{ icp: IcpRow }>('/me/icp', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  addStore: (name: string) =>
    req<{ store: { id: string; name: string; slug: string; tier: Tier } }>('/billing/stores', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameStore: (id: string, name: string) =>
    req<{ store: { id: string; name: string } }>(`/me/stores/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  // ── Billing actions ──
  billingPortal: () => req<{ url: string }>('/billing/portal'),
  pauseStore: (storeId: string) =>
    req<{ ok: true; pausedUntil: string }>('/billing/pause', {
      method: 'POST',
      body: JSON.stringify({ storeId }),
    }),
  resumeStore: (storeId: string) =>
    req<{ ok: true; tier: Tier }>('/billing/resume', {
      method: 'POST',
      body: JSON.stringify({ storeId }),
    }),

  // Direct upgrade flow (GET-redirect endpoint on the server). The dashboard
  // links straight to this URL; the server creates a Stripe Checkout session
  // and 303s the browser onward.
  checkoutUrl: (tier: 'core' | 'pro') => `${API_URL}/billing/checkout?tier=${tier}`,
}
