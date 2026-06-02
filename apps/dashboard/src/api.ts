// API client for the customer-facing Entuned dashboard.
//
// Differs from apps/admin/src/api.ts in one important way: dashboard auth is
// session-cookie based (magic-link / Google OAuth on the server set an httpOnly
// cookie), so every request goes out with `credentials: 'include'`. The admin
// app uses a Bearer token in localStorage; we deliberately do not duplicate
// that pattern here.

import { createRequestClient, TIER_RANK, TIER_LABEL, TIER_PRICE, highestTier } from '@entuned/api-client'
import type { Tier } from '@entuned/api-client'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
export const PLAYER_URL = import.meta.env.VITE_PLAYER_URL ?? 'https://music.entuned.co'

const { req } = createRequestClient({ baseUrl: API_URL, credentials: 'include' })

// ── Types ─────────────────────────────────────────────────────────

export type Role = 'owner' | 'manager' | 'staff'

// Tier branding (TIER_RANK / TIER_LABEL / TIER_PRICE) and the `highestTier`
// helper now live in @entuned/api-client (the branding SSOT). Re-exported here
// so existing dashboard call-sites that import from '../api.js' keep working.
export type { Tier }
export { TIER_RANK, TIER_LABEL, TIER_PRICE, highestTier }

export interface MeUser {
  id: string
  email: string
  displayName: string | null
}

export interface MeAccount {
  id: string
  companyName: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
}

export interface ProfilePatch {
  companyName?: string
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
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

export interface ScheduleSlot {
  id: string
  storeId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  outcomeId: string
  outcomeTitle: string
  outcomeDisplayTitle: string | null
}

export interface ScheduleSlotInput {
  dayOfWeek: number
  startTime: string
  endTime: string
  outcomeId: string
}

export interface OutcomeOption {
  id: string
  title: string
  displayTitle: string | null
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
  // `tier` is the *effective* tier (Stripe-paid OR active comp, whichever
  // ranks higher). Use this for feature gating throughout the dashboard.
  tier: Tier
  // `paidTier` is what Stripe is actually charging — exposed so billing
  // surfaces can show "Core ($99/mo, comped to Pro through Aug 12)" or a
  // small "comped" badge separate from the underlying paid plan.
  paidTier: Tier
  compTier: Tier | null
  compExpiresAt: string | null
  pausedUntil: string | null
  subscription: StoreSubscriptionSummary | null
}

export interface IcpInput {
  name: string
  ageRange?: string | null
  location?: string | null
  politicalSpectrum?: string | null
  openness?: string | null
  fears?: string | null
  values?: string | null
  desires?: string | null
  unexpressedDesires?: string | null
  turnOffs?: string | null
}

export interface IcpRow extends IcpInput {
  id: string
  updatedAt: string
}

export interface IcpListRow extends IcpRow {
  songCount: number
}

export interface MeIcpResponse {
  icp: IcpRow | null
  store: { id: string } | null
}

export interface OnboardProfileInput {
  industry: string
  zip?: string
  annualRevenueRange?: string
  employeeCountRange?: string
  storeLocationCount?: number
}

export type BoostTrialStatus = 'none' | 'generating' | 'active' | 'expired'

export interface BoostTrialStatusResponse {
  trialStatus: BoostTrialStatus
  daysRemaining: number | null
}

export interface BoostTrialInput {
  icpAgeCenter: string
  icpAgeRangeWide: boolean
  icpGenderSkew: string
  icpShoppingMode: string
  icpStorePersonality: string
  icpCurrentMusic: string
  icpCurrentMusicOther?: string
}

// ── Tier helpers ──────────────────────────────────────────────────

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

  // `next` is an optional post-login destination URL. Server validates it
  // against APP_URL/API_URL origin allowlist (see safeNext in routes/login.ts);
  // anything else is silently dropped and login lands on '/'.
  requestMagicLink: (email: string, next?: string) =>
    req<MagicLinkResponse>('/login/magic-link', {
      method: 'POST',
      body: JSON.stringify(next ? { email, next } : { email }),
    }),

  // GET-redirect endpoint, but expose the URL helper here so call-sites import
  // the constant rather than hardcoding it. `next` round-trips through the
  // OAuth handshake via a server-set cookie.
  googleLoginUrl: (next?: string) =>
    next
      ? `${API_URL}/login/google?next=${encodeURIComponent(next)}`
      : `${API_URL}/login/google`,

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
  meStoreIcp: (storeId: string) =>
    req<MeIcpResponse>(`/me/stores/${encodeURIComponent(storeId)}/icp`),
  saveMeStoreIcp: (storeId: string, input: IcpInput) =>
    req<{ icp: IcpRow }>(`/me/stores/${encodeURIComponent(storeId)}/icp`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  // Pro: multi-audience CRUD scoped to a Store.
  meStoreIcps: (storeId: string) =>
    req<{ icps: IcpListRow[] }>(`/me/stores/${encodeURIComponent(storeId)}/icps`),
  createIcp: (storeId: string, input: IcpInput) =>
    req<{ icp: IcpRow }>(`/me/stores/${encodeURIComponent(storeId)}/icps`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateIcp: (icpId: string, input: IcpInput) =>
    req<{ icp: IcpRow }>(`/me/icps/${encodeURIComponent(icpId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  retireIcp: (icpId: string) =>
    req<{ ok: true; archivedAt: string }>(`/me/icps/${encodeURIComponent(icpId)}/retire`, {
      method: 'POST',
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

  // In-app upgrade for an authenticated free customer. The server resolves
  // the user's free Store from the cookie session and creates the Stripe
  // Checkout. Pass storeId when the page knows which Store to upgrade
  // (e.g. deep-linked from the player); omit to let the server pick the
  // user's first free Store.
  upgradeUrl: (tier: 'core' | 'pro', storeId?: string) =>
    `${API_URL}/billing/upgrade?tier=${tier}${storeId ? `&store=${encodeURIComponent(storeId)}` : ''}`,

  // Profile editing — Client-level fields. Email is the auth identity and
  // cannot be changed here; do not include it in the patch.
  updateProfile: (body: ProfilePatch) =>
    req<MeAccount>('/me/profile', { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Schedule (Pro+, scoped to a specific store) ──
  meSchedule: (storeId: string) =>
    req<ScheduleSlot[]>(`/me/stores/${encodeURIComponent(storeId)}/schedule`),
  createScheduleSlot: (storeId: string, body: ScheduleSlotInput) =>
    req<ScheduleSlot>(`/me/stores/${encodeURIComponent(storeId)}/schedule`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateScheduleSlot: (id: string, body: ScheduleSlotInput) =>
    req<ScheduleSlot>(`/me/schedule-rows/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteScheduleSlot: (id: string) =>
    req<{ ok: true }>(`/me/schedule-rows/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  meOutcomes: () => req<OutcomeOption[]>('/me/outcomes'),

  // ── Onboarding ──
  saveOnboardProfile: (body: OnboardProfileInput) =>
    req<{ ok: true }>('/me/profile', { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Boost Trial ──
  startBoostTrial: (body: BoostTrialInput) =>
    req<{ ok: true; trialStatus: 'generating' }>('/me/boost-trial', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  boostTrialStatus: () => req<BoostTrialStatusResponse>('/me/boost-trial/status'),

  // ── Referral ──
  getReferralCode: () =>
    req<{ referralCode: string }>('/me/referral-code', { method: 'POST' }),

  // ── Upgrade (from comp trial) ──
  upgradeFromCompUrl: (storeId: string) =>
    `${API_URL}/billing/upgrade-from-comp?store=${encodeURIComponent(storeId)}`,
}
